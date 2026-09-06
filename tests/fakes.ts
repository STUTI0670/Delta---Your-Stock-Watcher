/**
 * In-memory implementations of Delta's repository interfaces.
 *
 * These let the checkpoint and alert services be tested against the same
 * contract the MongoDB implementations satisfy, without needing a live database
 * in the test run.
 */

import type {
  AlertEventRepository,
  AlertRepository,
  CheckpointRepository,
  StoredAlert,
  StoredAlertEvent,
  StoredCheckpoint,
  StoredWatchItem,
  WatchlistRepository,
  FeedbackRepository,
  StoredFeedback,
  NotificationPreferenceRepository,
  StoredNotificationPreference,
} from '@/lib/services/repositories';

/** Deep-ish copy so callers cannot mutate stored state by reference. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, val) =>
    typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val) ? new Date(val) : val
  ) as T;
}

export function createFakeCheckpointRepo(seed?: StoredCheckpoint) {
  const store = new Map<string, StoredCheckpoint>();
  if (seed) store.set(seed.userId, clone(seed));

  const repo: CheckpointRepository & { store: Map<string, StoredCheckpoint>; saveCount: number } = {
    store,
    saveCount: 0,
    async find(userId) {
      const found = store.get(userId);
      return found ? clone(found) : null;
    },
    async save(checkpoint) {
      repo.saveCount += 1;
      store.set(checkpoint.userId, clone(checkpoint));
    },
  };

  return repo;
}

export function createFakeWatchlistRepo(seed: StoredWatchItem[] = []) {
  let items = seed.map(clone);

  const repo: WatchlistRepository & { all: () => StoredWatchItem[] } = {
    all: () => items.map(clone),
    async list(userId) {
      return items.filter((item) => item.userId === userId).map(clone);
    },
    async add(item) {
      const exists = items.some((existing) => existing.userId === item.userId && existing.symbol === item.symbol);
      if (!exists) items.push(clone(item));
    },
    async remove(userId, symbol) {
      const before = items.length;
      items = items.filter((item) => !(item.userId === userId && item.symbol === symbol));
      return items.length < before;
    },
  };

  return repo;
}

export function createFakeAlertRepo(seed: StoredAlert[] = []) {
  let alerts = seed.map(clone);
  let nextId = seed.length + 1;

  const repo: AlertRepository & { all: () => StoredAlert[] } = {
    all: () => alerts.map(clone),
    async listByUser(userId) {
      return alerts.filter((alert) => alert.userId === userId).map(clone);
    },
    async listActive() {
      return alerts.filter((alert) => alert.isEnabled).map(clone);
    },
    async create(alert) {
      const created: StoredAlert = { ...clone(alert), id: `alert-${nextId++}` };
      alerts.push(created);
      return clone(created);
    },
    async update(userId, alertId, patch) {
      const index = alerts.findIndex((alert) => alert.id === alertId && alert.userId === userId);
      if (index === -1) return null;
      alerts[index] = { ...alerts[index], ...clone(patch) };
      return clone(alerts[index]);
    },
    async patchById(alertId, patch) {
      const index = alerts.findIndex((alert) => alert.id === alertId);
      if (index === -1) return;
      alerts[index] = { ...alerts[index], ...clone(patch) };
    },
    async remove(userId, alertId) {
      const before = alerts.length;
      alerts = alerts.filter((alert) => !(alert.id === alertId && alert.userId === userId));
      return alerts.length < before;
    },
  };

  return repo;
}

export function createFakeAlertEventRepo(seed: StoredAlertEvent[] = []) {
  const events = seed.map(clone);
  let nextId = seed.length + 1;

  const repo: AlertEventRepository & { all: () => StoredAlertEvent[] } = {
    all: () => events.map(clone),
    async record(event) {
      const stored: StoredAlertEvent = { ...clone(event), id: `event-${nextId++}` };
      events.push(stored);
      return clone(stored);
    },
    async listByUser(userId, limit = 25) {
      return events
        .filter((event) => event.userId === userId)
        .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime())
        .slice(0, limit)
        .map(clone);
    },
    async listByUserSince(userId, since) {
      return events
        .filter((event) => event.userId === userId && event.triggeredAt.getTime() >= since.getTime())
        .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime())
        .map(clone);
    },
    async markNotified(eventId, error = null) {
      const index = events.findIndex((event) => event.id === eventId);
      if (index === -1) return;
      events[index] = {
        ...events[index],
        notifiedAt: error ? null : new Date(),
        notificationError: error,
      };
    },
  };

  return repo;
}

export const makeAlert = (overrides: Partial<StoredAlert> = {}): StoredAlert => ({
  id: 'alert-1',
  userId: 'user-1',
  symbol: 'NVDA',
  company: 'NVIDIA Corp',
  direction: 'buy',
  threshold: 165,
  isEnabled: true,
  isArmed: true,
  lastTriggeredAt: null,
  lastTriggeredPrice: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
});

export function createFakeFeedbackRepo(seed: StoredFeedback[] = []) {
  let records = seed.map(clone);

  const repo: FeedbackRepository & { all: () => StoredFeedback[] } = {
    all: () => records.map(clone),
    async listByUser(userId) {
      return records.filter((r) => r.userId === userId).map(clone);
    },
    async record(feedback) {
      // Upsert: a newer opinion replaces the older one for that signal.
      records = records.filter(
        (r) =>
          !(r.userId === feedback.userId && r.symbol === feedback.symbol && r.signalKind === feedback.signalKind)
      );
      records.push(clone(feedback));
    },
    async clear(userId, symbol, signalKind) {
      const before = records.length;
      records = records.filter(
        (r) => !(r.userId === userId && r.symbol === symbol && r.signalKind === signalKind)
      );
      return records.length < before;
    },
  };

  return repo;
}

export function createFakeNotificationPrefRepo(seed: StoredNotificationPreference[] = []) {
  const store = new Map<string, StoredNotificationPreference>();
  for (const item of seed) store.set(item.userId, clone(item));

  const repo: NotificationPreferenceRepository = {
    async find(userId) {
      const found = store.get(userId);
      return found ? clone(found) : null;
    },
    async save(preference) {
      store.set(preference.userId, clone(preference));
    },
    async listByMode(mode) {
      return [...store.values()].filter((p) => p.mode === mode).map(clone);
    },
  };

  return repo;
}
