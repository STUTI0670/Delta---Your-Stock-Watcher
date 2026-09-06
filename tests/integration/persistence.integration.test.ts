/**
 * Integration coverage against a real MongoDB.
 *
 * The unit suites prove the business rules; this proves the Mongoose-backed
 * repositories actually satisfy the same contracts — indexes, upserts, user
 * scoping and durability across reconnects.
 *
 * Run with:  npm run test:integration   (needs MONGODB_URI)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  mongoAlertEventRepository,
  mongoAlertRepository,
  mongoCheckpointRepository,
  mongoWatchlistRepository,
} from '@/lib/services/repositories';
import { addWatchItem, listWatchlist, removeWatchItem } from '@/lib/services/watchlist.service';
import { commitCheckpoint, getCheckpoint, indexSnapshots } from '@/lib/services/checkpoint.service';
import {
  createAlert,
  deleteAlert,
  listAlertHistory,
  listAlerts,
  setAlertEnabled,
  sweepAlerts,
  updateAlert,
} from '@/lib/services/alert.service';
import { detectWatchlistChanges } from '@/lib/market/change-detection';
import { WatchItem } from '@/database/models/watch-item.model';
import { Checkpoint } from '@/database/models/checkpoint.model';
import { PriceAlert } from '@/database/models/price-alert.model';
import { AlertEvent } from '@/database/models/alert-event.model';
import { ChangeFeedback } from '@/database/models/change-feedback.model';
import { NotificationPreference } from '@/database/models/notification-preference.model';
import { mongoFeedbackRepository, mongoNotificationPreferenceRepository } from '@/lib/services/repositories';
import { clearFeedback, getFeedbackIndex, getSignalWeights, recordFeedback } from '@/lib/services/feedback.service';
import {
  collectPendingDigest,
  getNotificationMode,
  markDigestSent,
  setNotificationMode,
} from '@/lib/services/digest.service';

const USER = 'integration-user-1';
const OTHER = 'integration-user-2';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { bufferCommands: false });
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    WatchItem.deleteMany({}),
    Checkpoint.deleteMany({}),
    PriceAlert.deleteMany({}),
    AlertEvent.deleteMany({}),
    ChangeFeedback.deleteMany({}),
    NotificationPreference.deleteMany({}),
  ]);
});

describe('watchlist persistence (MongoDB)', () => {
  it('persists across sessions and is scoped per user', async () => {
    await addWatchItem(USER, 'nvda', 'NVIDIA Corp', mongoWatchlistRepository);
    await addWatchItem(USER, 'AAPL', 'Apple Inc', mongoWatchlistRepository);
    await addWatchItem(OTHER, 'TSLA', 'Tesla Inc', mongoWatchlistRepository);

    const mine = await listWatchlist(USER, mongoWatchlistRepository);
    expect(mine.map((i) => i.symbol).sort()).toEqual(['AAPL', 'NVDA']);
    expect((await listWatchlist(OTHER, mongoWatchlistRepository)).map((i) => i.symbol)).toEqual(['TSLA']);
  });

  it('is idempotent on re-adding the same symbol', async () => {
    await addWatchItem(USER, 'NVDA', 'NVIDIA Corp', mongoWatchlistRepository);
    await addWatchItem(USER, 'NVDA', 'NVIDIA Corp', mongoWatchlistRepository);

    expect(await WatchItem.countDocuments({ userId: USER })).toBe(1);
  });

  it('removes a symbol', async () => {
    await addWatchItem(USER, 'NVDA', 'NVIDIA Corp', mongoWatchlistRepository);
    expect(await removeWatchItem(USER, 'NVDA', mongoWatchlistRepository)).toBe(true);
    expect(await listWatchlist(USER, mongoWatchlistRepository)).toHaveLength(0);
  });
});

describe('checkpoint persistence (MongoDB)', () => {
  it('survives a full disconnect and reconnect', async () => {
    const t0 = new Date('2026-09-05T18:20:00Z');
    await commitCheckpoint(
      USER,
      [
        { symbol: 'NVDA', price: 100, updatedAt: t0 },
        { symbol: 'AAPL', price: 200, updatedAt: t0 },
      ],
      null,
      t0,
      mongoCheckpointRepository
    );

    // Simulates the user closing the browser and returning on another device.
    await mongoose.disconnect();
    await mongoose.connect(process.env.MONGODB_URI!, { bufferCommands: false });

    const reloaded = await getCheckpoint(USER, mongoCheckpointRepository);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.checkedAt.toISOString()).toBe(t0.toISOString());
    expect(indexSnapshots(reloaded).NVDA.price).toBe(100);
  });

  it('keeps exactly one checkpoint per user and updates it in place', async () => {
    const t0 = new Date('2026-09-05T18:20:00Z');
    const t1 = new Date('2026-09-06T09:00:00Z');

    await commitCheckpoint(USER, [{ symbol: 'NVDA', price: 100 }], null, t0, mongoCheckpointRepository);
    const previous = await getCheckpoint(USER, mongoCheckpointRepository);
    await commitCheckpoint(USER, [{ symbol: 'NVDA', price: 120 }], previous, t1, mongoCheckpointRepository);

    expect(await Checkpoint.countDocuments({ userId: USER })).toBe(1);
    const latest = await getCheckpoint(USER, mongoCheckpointRepository);
    expect(indexSnapshots(latest).NVDA.price).toBe(120);
  });

  it('answers "what changed since I last checked" against stored state', async () => {
    const yesterday = new Date('2026-09-05T18:20:00Z');
    await addWatchItem(USER, 'NVDA', 'NVIDIA Corp', mongoWatchlistRepository);
    await addWatchItem(USER, 'AAPL', 'Apple Inc', mongoWatchlistRepository);
    await commitCheckpoint(
      USER,
      [
        { symbol: 'NVDA', price: 100, updatedAt: yesterday },
        { symbol: 'AAPL', price: 100, updatedAt: yesterday },
      ],
      null,
      yesterday,
      mongoCheckpointRepository
    );

    const previous = await getCheckpoint(USER, mongoCheckpointRepository);
    const snapshots = indexSnapshots(previous);
    const watchlist = await listWatchlist(USER, mongoWatchlistRepository);

    const { needsAttention, changes } = detectWatchlistChanges(
      watchlist.map((item) => ({
        symbol: item.symbol,
        company: item.company,
        snapshot: snapshots[item.symbol],
        quote: {
          symbol: item.symbol,
          price: item.symbol === 'NVDA' ? 107.4 : 100.3,
          updatedAt: new Date(),
          stale: false,
          error: null,
        },
      }))
    );

    expect(changes).toHaveLength(2);
    expect(needsAttention.map((c) => c.symbol)).toEqual(['NVDA']);
    expect(needsAttention[0].changePercent).toBeCloseTo(7.4, 5);
  });
});

describe('price alerts and history (MongoDB)', () => {
  const priceSource = (map: Record<string, number | null>) => async () => map;

  it('runs the full alert lifecycle without duplicate notifications', async () => {
    const created = await createAlert(
      { userId: USER, symbol: 'NVDA', company: 'NVIDIA Corp', direction: 'buy', threshold: 165 },
      mongoAlertRepository
    );
    expect(created.isEnabled).toBe(true);
    expect(created.isArmed).toBe(true);

    const notified: string[] = [];
    const deps = {
      alerts: mongoAlertRepository,
      events: mongoAlertEventRepository,
      notify: async (event: { symbol: string; triggeredPrice: number }) => {
        notified.push(`${event.symbol}@${event.triggeredPrice}`);
      },
    };

    // $166 no alert, $165 fires, $164 and $163 stay silent.
    await sweepAlerts({ ...deps, getPrices: priceSource({ NVDA: 166 }) });
    expect(notified).toHaveLength(0);

    await sweepAlerts({ ...deps, getPrices: priceSource({ NVDA: 165 }) });
    await sweepAlerts({ ...deps, getPrices: priceSource({ NVDA: 164 }) });
    await sweepAlerts({ ...deps, getPrices: priceSource({ NVDA: 163 }) });

    expect(notified).toEqual(['NVDA@165']);
    expect(await AlertEvent.countDocuments({ userId: USER })).toBe(1);

    const stored = (await listAlerts(USER, mongoAlertRepository))[0];
    expect(stored.isArmed).toBe(false);
    expect(stored.lastTriggeredPrice).toBe(165);

    const history = await listAlertHistory(USER, 25, mongoAlertEventRepository);
    expect(history[0].message).toContain('crossing your buy threshold');
    expect(history[0].notifiedAt).not.toBeNull();
  });

  it('does not fire a disabled alert and fires again once re-enabled', async () => {
    const alert = await createAlert(
      { userId: USER, symbol: 'TSLA', company: 'Tesla Inc', direction: 'sell', threshold: 350 },
      mongoAlertRepository
    );
    await setAlertEnabled(USER, alert.id, false, mongoAlertRepository);

    const deps = { alerts: mongoAlertRepository, events: mongoAlertEventRepository };
    await sweepAlerts({ ...deps, getPrices: priceSource({ TSLA: 400 }) });
    expect(await AlertEvent.countDocuments({ userId: USER })).toBe(0);

    await setAlertEnabled(USER, alert.id, true, mongoAlertRepository);
    await sweepAlerts({ ...deps, getPrices: priceSource({ TSLA: 400 }) });
    expect(await AlertEvent.countDocuments({ userId: USER })).toBe(1);
  });

  it('re-arms on an edit so the new threshold can fire', async () => {
    const alert = await createAlert(
      { userId: USER, symbol: 'NVDA', company: 'NVIDIA Corp', direction: 'buy', threshold: 165 },
      mongoAlertRepository
    );
    const deps = { alerts: mongoAlertRepository, events: mongoAlertEventRepository };

    await sweepAlerts({ ...deps, getPrices: priceSource({ NVDA: 160 }) });
    expect(await AlertEvent.countDocuments({ userId: USER })).toBe(1);

    await updateAlert(USER, alert.id, { threshold: 155 }, mongoAlertRepository);
    await sweepAlerts({ ...deps, getPrices: priceSource({ NVDA: 150 }) });
    expect(await AlertEvent.countDocuments({ userId: USER })).toBe(2);
  });

  it('keeps alert history after the alert itself is deleted', async () => {
    const alert = await createAlert(
      { userId: USER, symbol: 'NVDA', company: 'NVIDIA Corp', direction: 'buy', threshold: 165 },
      mongoAlertRepository
    );

    await sweepAlerts({
      alerts: mongoAlertRepository,
      events: mongoAlertEventRepository,
      getPrices: priceSource({ NVDA: 160 }),
    });

    expect(await deleteAlert(USER, alert.id, mongoAlertRepository)).toBe(true);
    expect(await listAlerts(USER, mongoAlertRepository)).toHaveLength(0);

    const history = await listAlertHistory(USER, 25, mongoAlertEventRepository);
    expect(history).toHaveLength(1);
    expect(history[0].symbol).toBe('NVDA');
  });

  it('does not expose one user alerts or history to another', async () => {
    await createAlert(
      { userId: USER, symbol: 'NVDA', company: 'NVIDIA Corp', direction: 'buy', threshold: 165 },
      mongoAlertRepository
    );
    await sweepAlerts({
      alerts: mongoAlertRepository,
      events: mongoAlertEventRepository,
      getPrices: priceSource({ NVDA: 160 }),
    });

    expect(await listAlerts(OTHER, mongoAlertRepository)).toHaveLength(0);
    expect(await listAlertHistory(OTHER, 25, mongoAlertEventRepository)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ P2 ---- */

describe('feedback persistence (MongoDB)', () => {
  it('upserts so a changed mind replaces the old vote', async () => {
    await recordFeedback(USER, 'NVDA', 'price', 'useful', mongoFeedbackRepository);
    await recordFeedback(USER, 'NVDA', 'price', 'not-useful', mongoFeedbackRepository);

    expect(await ChangeFeedback.countDocuments({ userId: USER })).toBe(1);
    const weights = await getSignalWeights(USER, mongoFeedbackRepository);
    expect(weights.price).toBeLessThan(1);
  });

  it('keeps signals and users apart', async () => {
    await recordFeedback(USER, 'NVDA', 'price', 'useful', mongoFeedbackRepository);
    await recordFeedback(USER, 'NVDA', 'volume', 'not-useful', mongoFeedbackRepository);
    await recordFeedback(OTHER, 'NVDA', 'price', 'not-useful', mongoFeedbackRepository);

    const mine = await getSignalWeights(USER, mongoFeedbackRepository);
    expect(mine.price).toBeGreaterThan(1);
    expect(mine.volume).toBeLessThan(1);

    const theirs = await getSignalWeights(OTHER, mongoFeedbackRepository);
    expect(theirs.price).toBeLessThan(1);
  });

  it('survives a disconnect and reconnect', async () => {
    await recordFeedback(USER, 'TSLA', 'event', 'useful', mongoFeedbackRepository);

    await mongoose.disconnect();
    await mongoose.connect(process.env.MONGODB_URI!, { bufferCommands: false });

    const index = await getFeedbackIndex(USER, mongoFeedbackRepository);
    expect(index['TSLA:event']).toBe('useful');
  });

  it('clears a vote back to neutral', async () => {
    await recordFeedback(USER, 'NVDA', 'price', 'useful', mongoFeedbackRepository);
    expect(await clearFeedback(USER, 'NVDA', 'price', mongoFeedbackRepository)).toBe(true);
    expect((await getSignalWeights(USER, mongoFeedbackRepository)).price).toBe(1);
  });
});

describe('notification preference and digest (MongoDB)', () => {
  it('defaults to individual and remembers a switch to digest', async () => {
    expect(await getNotificationMode(USER, mongoNotificationPreferenceRepository)).toBe('individual');

    await setNotificationMode(USER, 'digest', mongoNotificationPreferenceRepository);
    expect(await getNotificationMode(USER, mongoNotificationPreferenceRepository)).toBe('digest');
    expect(await NotificationPreference.countDocuments({ userId: USER })).toBe(1);
  });

  it('bundles crossings since the last digest, then does not repeat them', async () => {
    await setNotificationMode(USER, 'digest', mongoNotificationPreferenceRepository);
    const alert = await createAlert(
      { userId: USER, symbol: 'NVDA', company: 'NVIDIA Corp', direction: 'buy', threshold: 165 },
      mongoAlertRepository
    );
    expect(alert.isArmed).toBe(true);

    await sweepAlerts({
      alerts: mongoAlertRepository,
      events: mongoAlertEventRepository,
      getPrices: async () => ({ NVDA: 164 }),
    });

    const preference = (await mongoNotificationPreferenceRepository.find(USER))!;
    const pending = await collectPendingDigest(preference, new Date(), mongoAlertEventRepository);
    expect(pending!.summary.totalCrossings).toBe(1);

    const sentAt = new Date();
    await markDigestSent(USER, sentAt, mongoNotificationPreferenceRepository);

    const after = (await mongoNotificationPreferenceRepository.find(USER))!;
    expect(after.mode).toBe('digest');
    expect(await collectPendingDigest(after, new Date(), mongoAlertEventRepository)).toBeNull();
  });

  it('lists only the users who opted into digests', async () => {
    await setNotificationMode(USER, 'digest', mongoNotificationPreferenceRepository);
    await setNotificationMode(OTHER, 'individual', mongoNotificationPreferenceRepository);

    const subscribers = await mongoNotificationPreferenceRepository.listByMode('digest');
    expect(subscribers.map((s) => s.userId)).toEqual([USER]);
  });
});
