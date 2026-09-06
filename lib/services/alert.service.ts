/**
 * Price alert service — CRUD plus the sweep the background poller runs.
 *
 * All trigger/re-arm decisions are delegated to the pure rules in
 * lib/market/alert-rules.ts; this module only orchestrates persistence and
 * notification around them.
 */

import { buildAlertMessage, evaluateAlert, type AlertDirection } from '@/lib/market/alert-rules';
import {
  mongoAlertEventRepository,
  mongoAlertRepository,
  type AlertEventRepository,
  type AlertRepository,
  type StoredAlert,
  type StoredAlertEvent,
} from '@/lib/services/repositories';

export interface CreateAlertInput {
  userId: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
}

export interface UpdateAlertInput {
  threshold?: number;
  direction?: AlertDirection;
  isEnabled?: boolean;
}

function assertValidThreshold(threshold: number) {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('Threshold must be a positive number.');
  }
}

export async function listAlerts(
  userId: string,
  repo: AlertRepository = mongoAlertRepository
): Promise<StoredAlert[]> {
  if (!userId) return [];
  return repo.listByUser(userId);
}

export async function createAlert(
  input: CreateAlertInput,
  repo: AlertRepository = mongoAlertRepository
): Promise<StoredAlert> {
  assertValidThreshold(input.threshold);
  if (!input.userId) throw new Error('A signed-in user is required.');

  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('A symbol is required.');

  return repo.create({
    userId: input.userId,
    symbol,
    company: input.company?.trim() || symbol,
    direction: input.direction,
    threshold: input.threshold,
    isEnabled: true,
    // A new alert starts armed so it can fire on the very next sweep.
    isArmed: true,
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    createdAt: new Date(),
  });
}

export async function updateAlert(
  userId: string,
  alertId: string,
  patch: UpdateAlertInput,
  repo: AlertRepository = mongoAlertRepository
): Promise<StoredAlert | null> {
  if (patch.threshold !== undefined) assertValidThreshold(patch.threshold);

  // Editing the threshold or direction describes a brand new condition, so the
  // alert is re-armed AND its cooldown is cleared. Without clearing the
  // timestamp the old crossing would keep the new condition silent for hours,
  // which is not what a user who just changed the price expects.
  const isNewCondition = patch.threshold !== undefined || patch.direction !== undefined;

  return repo.update(userId, alertId, {
    ...patch,
    ...(isNewCondition ? { isArmed: true, lastTriggeredAt: null, lastTriggeredPrice: null } : {}),
  });
}

export async function setAlertEnabled(
  userId: string,
  alertId: string,
  isEnabled: boolean,
  repo: AlertRepository = mongoAlertRepository
): Promise<StoredAlert | null> {
  return repo.update(userId, alertId, { isEnabled });
}

export async function deleteAlert(
  userId: string,
  alertId: string,
  repo: AlertRepository = mongoAlertRepository
): Promise<boolean> {
  if (!userId) return false;
  return repo.remove(userId, alertId);
}

export async function listAlertHistory(
  userId: string,
  limit = 25,
  repo: AlertEventRepository = mongoAlertEventRepository
): Promise<StoredAlertEvent[]> {
  if (!userId) return [];
  return repo.listByUser(userId, limit);
}

export interface SweepDeps {
  alerts?: AlertRepository;
  events?: AlertEventRepository;
  /** Returns the latest price per symbol; null means "unavailable right now". */
  getPrices: (symbols: string[]) => Promise<Record<string, number | null>>;
  /** Delivers the notification. Rejection is recorded, never thrown upward. */
  notify?: (event: StoredAlertEvent) => Promise<void>;
  now?: Date;
}

export interface SweepResult {
  evaluated: number;
  triggered: number;
  rearmed: number;
  events: StoredAlertEvent[];
}

/**
 * One pass of the alert poller.
 *
 * Every enabled alert is evaluated against the latest price. Alerts that fire
 * are disarmed in the same pass and recorded in history, which is what makes
 * repeated sweeps over a price sitting past the threshold silent.
 */
export async function sweepAlerts(deps: SweepDeps): Promise<SweepResult> {
  const alertRepo = deps.alerts ?? mongoAlertRepository;
  const eventRepo = deps.events ?? mongoAlertEventRepository;
  const now = deps.now ?? new Date();

  const alerts = await alertRepo.listActive();
  if (alerts.length === 0) return { evaluated: 0, triggered: 0, rearmed: 0, events: [] };

  const symbols = Array.from(new Set(alerts.map((alert) => alert.symbol)));
  const prices = await deps.getPrices(symbols);

  const events: StoredAlertEvent[] = [];
  let triggered = 0;
  let rearmed = 0;

  for (const alert of alerts) {
    const price = prices[alert.symbol] ?? null;
    const evaluation = evaluateAlert(alert, price, now);

    if (evaluation.outcome === 'idle' && evaluation.nextArmed === alert.isArmed) continue;

    if (evaluation.outcome === 'rearm') {
      rearmed += 1;
      await alertRepo.patchById(alert.id, { isArmed: true });
      continue;
    }

    if (evaluation.outcome !== 'trigger' || price === null) continue;

    // Disarm before notifying: if delivery fails we would rather miss a
    // notification than send the same one on every subsequent sweep.
    await alertRepo.patchById(alert.id, {
      isArmed: false,
      lastTriggeredAt: now,
      lastTriggeredPrice: price,
    });

    const event = await eventRepo.record({
      userId: alert.userId,
      alertId: alert.id,
      symbol: alert.symbol,
      company: alert.company,
      direction: alert.direction,
      threshold: alert.threshold,
      triggeredPrice: price,
      message: buildAlertMessage(alert.symbol, alert.direction, alert.threshold, price),
      triggeredAt: now,
      notifiedAt: null,
      notificationError: null,
    });

    triggered += 1;
    events.push(event);

    if (deps.notify) {
      try {
        await deps.notify(event);
        if (event.id) await eventRepo.markNotified(event.id, null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Notification delivery failed.';
        console.error('Alert notification failed for', alert.symbol, err);
        if (event.id) await eventRepo.markNotified(event.id, message);
      }
    }
  }

  return { evaluated: alerts.length, triggered, rearmed, events };
}
