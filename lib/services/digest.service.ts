/**
 * Notification preferences and the smart alert digest.
 *
 * A user on 'individual' mode gets one email per crossing (the P1 behaviour).
 * A user on 'digest' mode gets nothing at trigger time; a periodic job instead
 * rolls up everything that fired since their last digest into one message.
 *
 * Crossings are written to alert history either way, so switching modes never
 * loses history — it only changes how loudly the user is told.
 */

import {
  mongoAlertEventRepository,
  mongoNotificationPreferenceRepository,
  type AlertEventRepository,
  type NotificationPreferenceRepository,
  type StoredAlertEvent,
  type StoredNotificationPreference,
} from '@/lib/services/repositories';
import { currencyForSymbol, formatMoney } from '@/lib/market/currency';
import type { NotificationMode } from '@/database/models/notification-preference.model';

export type { NotificationMode };

/** How far back a first-ever digest reaches. */
const FIRST_DIGEST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function getNotificationMode(
  userId: string,
  repo: NotificationPreferenceRepository = mongoNotificationPreferenceRepository
): Promise<NotificationMode> {
  if (!userId) return 'individual';
  try {
    const preference = await repo.find(userId);
    return preference?.mode ?? 'individual';
  } catch (err) {
    // Defaulting to individual is the safe failure: the user still hears about
    // a crossing, they simply do not get it bundled.
    console.error('getNotificationMode failed; defaulting to individual', err);
    return 'individual';
  }
}

export async function setNotificationMode(
  userId: string,
  mode: NotificationMode,
  repo: NotificationPreferenceRepository = mongoNotificationPreferenceRepository
): Promise<void> {
  if (!userId) throw new Error('A signed-in user is required.');
  const existing = await repo.find(userId);
  await repo.save({ userId, mode, lastDigestAt: existing?.lastDigestAt ?? null });
}

export interface DigestSummary {
  totalCrossings: number;
  symbolCount: number;
  buyCount: number;
  sellCount: number;
  headline: string;
  lines: string[];
}

/**
 * Turn a batch of crossings into one summary. Pure given its input, so the
 * wording is testable without sending mail.
 */
export function summarizeDigest(events: StoredAlertEvent[]): DigestSummary {
  const symbols = new Set(events.map((event) => event.symbol));
  const buyCount = events.filter((event) => event.direction === 'buy').length;
  const sellCount = events.filter((event) => event.direction === 'sell').length;

  const lines = events.map((event) => {
    const currency = currencyForSymbol(event.symbol);
    const verb = event.direction === 'buy' ? 'fell to' : 'rose to';
    return `${event.symbol} ${verb} ${formatMoney(event.triggeredPrice, currency)} — your ${event.direction} price was ${formatMoney(event.threshold, currency)}`;
  });

  const crossingWord = events.length === 1 ? 'price alert was' : 'price alerts were';
  const symbolWord = symbols.size === 1 ? 'stock' : 'stocks';

  return {
    totalCrossings: events.length,
    symbolCount: symbols.size,
    buyCount,
    sellCount,
    headline: `${events.length} ${crossingWord} triggered across ${symbols.size} ${symbolWord}.`,
    lines,
  };
}

export interface PendingDigest {
  userId: string;
  events: StoredAlertEvent[];
  since: Date;
  summary: DigestSummary;
}

/**
 * Everything that fired for one user since their last digest.
 *
 * Returns null when there is nothing to send — a digest job should stay silent
 * rather than mail an empty summary.
 */
export async function collectPendingDigest(
  preference: StoredNotificationPreference,
  now: Date = new Date(),
  repo: AlertEventRepository = mongoAlertEventRepository
): Promise<PendingDigest | null> {
  const since = preference.lastDigestAt ?? new Date(now.getTime() - FIRST_DIGEST_LOOKBACK_MS);
  const events = await repo.listByUserSince(preference.userId, since);
  if (events.length === 0) return null;

  return { userId: preference.userId, events, since, summary: summarizeDigest(events) };
}

export async function markDigestSent(
  userId: string,
  at: Date,
  repo: NotificationPreferenceRepository = mongoNotificationPreferenceRepository
): Promise<void> {
  const existing = await repo.find(userId);
  await repo.save({ userId, mode: existing?.mode ?? 'digest', lastDigestAt: at });
}
