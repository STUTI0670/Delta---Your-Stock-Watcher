/**
 * Persistence boundaries for Delta's domain services.
 *
 * Services depend on these interfaces rather than on Mongoose directly. That
 * keeps checkpoint and alert behaviour testable with in-memory fakes while the
 * application wires in the real MongoDB-backed implementations below.
 */

import { connectToDatabase } from '@/database/mongoose';
import { Checkpoint, type CheckpointPriceSnapshot } from '@/database/models/checkpoint.model';
import { PriceAlert, type AlertDirection } from '@/database/models/price-alert.model';
import { AlertEvent } from '@/database/models/alert-event.model';
import { WatchItem } from '@/database/models/watch-item.model';
import {
  ChangeFeedback,
  type FeedbackSignalKind,
  type FeedbackVote,
} from '@/database/models/change-feedback.model';
import {
  NotificationPreference,
  type NotificationMode,
} from '@/database/models/notification-preference.model';

export interface StoredCheckpoint {
  userId: string;
  checkedAt: Date;
  snapshots: CheckpointPriceSnapshot[];
}

export interface CheckpointRepository {
  find(userId: string): Promise<StoredCheckpoint | null>;
  save(checkpoint: StoredCheckpoint): Promise<void>;
}

export interface StoredWatchItem {
  userId: string;
  symbol: string;
  company: string;
  addedAt: Date;
}

export interface WatchlistRepository {
  list(userId: string): Promise<StoredWatchItem[]>;
  add(item: StoredWatchItem): Promise<void>;
  remove(userId: string, symbol: string): Promise<boolean>;
}

export interface StoredAlert {
  id: string;
  userId: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
  isEnabled: boolean;
  isArmed: boolean;
  lastTriggeredAt: Date | null;
  lastTriggeredPrice: number | null;
  createdAt?: Date;
}

export interface AlertPatch {
  threshold?: number;
  direction?: AlertDirection;
  isEnabled?: boolean;
  isArmed?: boolean;
  lastTriggeredAt?: Date | null;
  lastTriggeredPrice?: number | null;
}

export interface AlertRepository {
  listByUser(userId: string): Promise<StoredAlert[]>;
  listActive(): Promise<StoredAlert[]>;
  create(alert: Omit<StoredAlert, 'id'>): Promise<StoredAlert>;
  update(userId: string, alertId: string, patch: AlertPatch): Promise<StoredAlert | null>;
  patchById(alertId: string, patch: AlertPatch): Promise<void>;
  remove(userId: string, alertId: string): Promise<boolean>;
}

export interface StoredAlertEvent {
  id?: string;
  userId: string;
  alertId: string;
  symbol: string;
  company: string;
  direction: AlertDirection;
  threshold: number;
  triggeredPrice: number;
  message: string;
  triggeredAt: Date;
  notifiedAt: Date | null;
  notificationError: string | null;
}

export interface AlertEventRepository {
  record(event: StoredAlertEvent): Promise<StoredAlertEvent>;
  listByUser(userId: string, limit?: number): Promise<StoredAlertEvent[]>;
  /** Events since a point in time — powers the "thresholds reached" tally. */
  listByUserSince(userId: string, since: Date): Promise<StoredAlertEvent[]>;
  markNotified(eventId: string, error?: string | null): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*                        MongoDB-backed implementations                       */
/* -------------------------------------------------------------------------- */

export const mongoCheckpointRepository: CheckpointRepository = {
  async find(userId) {
    await connectToDatabase();
    const doc = await Checkpoint.findOne({ userId }).lean();
    if (!doc) return null;
    return {
      userId: doc.userId,
      checkedAt: doc.checkedAt,
      snapshots: doc.snapshots ?? [],
    };
  },
  async save(checkpoint) {
    await connectToDatabase();
    await Checkpoint.updateOne(
      { userId: checkpoint.userId },
      { $set: { checkedAt: checkpoint.checkedAt, snapshots: checkpoint.snapshots } },
      { upsert: true }
    );
  },
};

export const mongoWatchlistRepository: WatchlistRepository = {
  async list(userId) {
    await connectToDatabase();
    const items = await WatchItem.find({ userId }).sort({ addedAt: -1 }).lean();
    return items.map((item) => ({
      userId: item.userId,
      symbol: item.symbol,
      company: item.company,
      addedAt: item.addedAt,
    }));
  },
  async add(item) {
    await connectToDatabase();
    await WatchItem.updateOne(
      { userId: item.userId, symbol: item.symbol },
      { $setOnInsert: { company: item.company, addedAt: item.addedAt } },
      { upsert: true }
    );
  },
  async remove(userId, symbol) {
    await connectToDatabase();
    const result = await WatchItem.deleteOne({ userId, symbol: symbol.toUpperCase() });
    return result.deletedCount > 0;
  },
};

function toStoredAlert(doc: Record<string, unknown>): StoredAlert {
  return {
    id: String(doc._id),
    userId: doc.userId as string,
    symbol: doc.symbol as string,
    company: doc.company as string,
    direction: doc.direction as AlertDirection,
    threshold: doc.threshold as number,
    isEnabled: doc.isEnabled as boolean,
    isArmed: doc.isArmed as boolean,
    lastTriggeredAt: (doc.lastTriggeredAt as Date) ?? null,
    lastTriggeredPrice: (doc.lastTriggeredPrice as number) ?? null,
    createdAt: doc.createdAt as Date | undefined,
  };
}

export const mongoAlertRepository: AlertRepository = {
  async listByUser(userId) {
    await connectToDatabase();
    const docs = await PriceAlert.find({ userId }).sort({ createdAt: -1 }).lean();
    return docs.map((d) => toStoredAlert(d as unknown as Record<string, unknown>));
  },
  async listActive() {
    await connectToDatabase();
    // The poller needs disarmed alerts too, so they get a chance to re-arm.
    const docs = await PriceAlert.find({ isEnabled: true }).lean();
    return docs.map((d) => toStoredAlert(d as unknown as Record<string, unknown>));
  },
  async create(alert) {
    await connectToDatabase();
    const doc = await PriceAlert.create(alert);
    return toStoredAlert(doc.toObject() as unknown as Record<string, unknown>);
  },
  async update(userId, alertId, patch) {
    await connectToDatabase();
    const doc = await PriceAlert.findOneAndUpdate({ _id: alertId, userId }, { $set: patch }, { new: true }).lean();
    return doc ? toStoredAlert(doc as unknown as Record<string, unknown>) : null;
  },
  async patchById(alertId, patch) {
    await connectToDatabase();
    await PriceAlert.updateOne({ _id: alertId }, { $set: patch });
  },
  async remove(userId, alertId) {
    await connectToDatabase();
    const result = await PriceAlert.deleteOne({ _id: alertId, userId });
    return result.deletedCount > 0;
  },
};

export const mongoAlertEventRepository: AlertEventRepository = {
  async record(event) {
    await connectToDatabase();
    const doc = await AlertEvent.create(event);
    return { ...event, id: String(doc._id) };
  },
  async listByUser(userId, limit = 25) {
    await connectToDatabase();
    const docs = await AlertEvent.find({ userId }).sort({ triggeredAt: -1 }).limit(limit).lean();
    return docs.map((doc) => ({
      id: String(doc._id),
      userId: doc.userId,
      alertId: doc.alertId,
      symbol: doc.symbol,
      company: doc.company,
      direction: doc.direction,
      threshold: doc.threshold,
      triggeredPrice: doc.triggeredPrice,
      message: doc.message,
      triggeredAt: doc.triggeredAt,
      notifiedAt: doc.notifiedAt ?? null,
      notificationError: doc.notificationError ?? null,
    }));
  },
  async listByUserSince(userId, since) {
    await connectToDatabase();
    const docs = await AlertEvent.find({ userId, triggeredAt: { $gte: since } })
      .sort({ triggeredAt: -1 })
      .lean();
    return docs.map((doc) => ({
      id: String(doc._id),
      userId: doc.userId,
      alertId: doc.alertId,
      symbol: doc.symbol,
      company: doc.company,
      direction: doc.direction,
      threshold: doc.threshold,
      triggeredPrice: doc.triggeredPrice,
      message: doc.message,
      triggeredAt: doc.triggeredAt,
      notifiedAt: doc.notifiedAt ?? null,
      notificationError: doc.notificationError ?? null,
    }));
  },
  async markNotified(eventId, error = null) {
    await connectToDatabase();
    await AlertEvent.updateOne(
      { _id: eventId },
      { $set: { notifiedAt: error ? null : new Date(), notificationError: error } }
    );
  },
};

/* -------------------------------------------------------------------------- */
/*                 P2 — feedback and notification preferences                  */
/* -------------------------------------------------------------------------- */

export interface StoredFeedback {
  userId: string;
  symbol: string;
  signalKind: FeedbackSignalKind;
  vote: FeedbackVote;
  createdAt: Date;
}

export interface FeedbackRepository {
  listByUser(userId: string): Promise<StoredFeedback[]>;
  /** Upsert: a newer opinion for a (symbol, signal) replaces the older one. */
  record(feedback: StoredFeedback): Promise<void>;
  clear(userId: string, symbol: string, signalKind: FeedbackSignalKind): Promise<boolean>;
}

export interface StoredNotificationPreference {
  userId: string;
  mode: NotificationMode;
  lastDigestAt: Date | null;
}

export interface NotificationPreferenceRepository {
  find(userId: string): Promise<StoredNotificationPreference | null>;
  save(preference: StoredNotificationPreference): Promise<void>;
  listByMode(mode: NotificationMode): Promise<StoredNotificationPreference[]>;
}

export const mongoFeedbackRepository: FeedbackRepository = {
  async listByUser(userId) {
    await connectToDatabase();
    const docs = await ChangeFeedback.find({ userId }).lean();
    return docs.map((doc) => ({
      userId: doc.userId,
      symbol: doc.symbol,
      signalKind: doc.signalKind,
      vote: doc.vote,
      createdAt: doc.createdAt,
    }));
  },
  async record(feedback) {
    await connectToDatabase();
    await ChangeFeedback.updateOne(
      { userId: feedback.userId, symbol: feedback.symbol, signalKind: feedback.signalKind },
      { $set: { vote: feedback.vote, createdAt: feedback.createdAt } },
      { upsert: true }
    );
  },
  async clear(userId, symbol, signalKind) {
    await connectToDatabase();
    const result = await ChangeFeedback.deleteOne({ userId, symbol, signalKind });
    return result.deletedCount > 0;
  },
};

export const mongoNotificationPreferenceRepository: NotificationPreferenceRepository = {
  async find(userId) {
    await connectToDatabase();
    const doc = await NotificationPreference.findOne({ userId }).lean();
    if (!doc) return null;
    return { userId: doc.userId, mode: doc.mode, lastDigestAt: doc.lastDigestAt ?? null };
  },
  async save(preference) {
    await connectToDatabase();
    await NotificationPreference.updateOne(
      { userId: preference.userId },
      { $set: { mode: preference.mode, lastDigestAt: preference.lastDigestAt } },
      { upsert: true }
    );
  },
  async listByMode(mode) {
    await connectToDatabase();
    const docs = await NotificationPreference.find({ mode }).lean();
    return docs.map((doc) => ({ userId: doc.userId, mode: doc.mode, lastDigestAt: doc.lastDigestAt ?? null }));
  },
};
