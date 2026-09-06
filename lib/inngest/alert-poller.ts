import { inngest } from '@/lib/inngest/client';
import { connectToDatabase } from '@/database/mongoose';
import { fetchSymbols } from '@/lib/market/providers/yahoo';
import { sweepAlerts } from '@/lib/services/alert.service';
import { sendPriceAlertNotification } from '@/lib/services/notification.service';
import type { StoredAlertEvent } from '@/lib/services/repositories';
import {
  collectPendingDigest,
  getNotificationMode,
  markDigestSent,
} from '@/lib/services/digest.service';
import { mongoNotificationPreferenceRepository } from '@/lib/services/repositories';
import { sendAlertDigestNotification } from '@/lib/services/notification.service';

/** Recipients are looked up once per sweep rather than once per alert. */
const recipientCache = new Map<string, { email: string; name?: string } | null>();

/** Look up a recipient by Better Auth user id. */
async function findRecipient(userId: string): Promise<{ email: string; name?: string } | null> {
  try {
    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) return null;

    const { ObjectId } = await import('mongodb');
    const or: Record<string, unknown>[] = [{ id: userId }];
    if (ObjectId.isValid(userId)) or.push({ _id: new ObjectId(userId) });

    const user = await db.collection('user').findOne<{ email?: string; name?: string }>({ $or: or });
    if (!user?.email) return null;
    return { email: user.email, name: user.name };
  } catch (err) {
    console.error('findRecipient failed for', userId, err);
    return null;
  }
}

/**
 * Deliver one crossing — unless the user has asked for a digest, in which case
 * we stay silent here and let the digest job bundle it later. The event is
 * already recorded in history either way, so nothing is lost by not emailing.
 */
async function deliver(event: StoredAlertEvent): Promise<void> {
  const mode = await getNotificationMode(event.userId);
  if (mode === 'digest') return;

  if (!recipientCache.has(event.userId)) {
    recipientCache.set(event.userId, await findRecipient(event.userId));
  }
  const recipient = recipientCache.get(event.userId) ?? null;
  if (!recipient) throw new Error('No recipient found for this alert.');

  await sendPriceAlertNotification(recipient, event);
}

/**
 * Delta's price-alert poller.
 *
 * Runs every five minutes during and around market hours. Idempotency is a
 * property of the alert state machine (armed/disarmed), not of the schedule, so
 * running this more often only makes alerts timelier — never noisier.
 */
export const pollPriceAlerts = inngest.createFunction(
  { id: 'poll-price-alerts', name: 'Poll watchlist price alerts' },
  [{ event: 'watchpoint/alerts.poll' }, { cron: '*/5 * * * *' }],
  async ({ step }) => {
    const result = await step.run('sweep-price-alerts', async () =>
      sweepAlerts({
        getPrices: async (symbols) => {
          const market = await fetchSymbols(symbols);
          return symbols.reduce<Record<string, number | null>>((acc, symbol) => {
            acc[symbol] = market[symbol]?.quote.price ?? null;
            return acc;
          }, {});
        },
        notify: deliver,
      })
    );

    return {
      success: true,
      evaluated: result.evaluated,
      triggered: result.triggered,
      rearmed: result.rearmed,
    };
  }
);


/**
 * The smart digest.
 *
 * For users who opted out of per-crossing emails, this bundles everything that
 * fired since their last digest into one message. It sends nothing when nothing
 * happened, and only advances the digest marker after a successful send, so a
 * failed delivery is retried rather than silently skipped.
 */
export const sendAlertDigests = inngest.createFunction(
  { id: 'send-alert-digests', name: 'Send bundled alert digests' },
  [{ event: 'watchpoint/alerts.digest' }, { cron: '0 * * * *' }],
  async ({ step }) => {
    const sent = await step.run('send-digests', async () => {
      const subscribers = await mongoNotificationPreferenceRepository.listByMode('digest');
      const now = new Date();
      let delivered = 0;

      for (const preference of subscribers) {
        try {
          const pending = await collectPendingDigest(preference, now);
          if (!pending) continue;

          const recipient = await findRecipient(preference.userId);
          if (!recipient) continue;

          await sendAlertDigestNotification(recipient, pending.summary, pending.since);
          // Only now: a failed send must not skip these crossings next time.
          await markDigestSent(preference.userId, now);
          delivered += 1;
        } catch (err) {
          console.error('Alert digest failed for', preference.userId, err);
        }
      }

      return delivered;
    });

    return { success: true, digestsSent: sent };
  }
);
