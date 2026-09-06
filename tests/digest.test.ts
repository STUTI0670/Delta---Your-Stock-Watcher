import { describe, expect, it, vi } from 'vitest';
import {
  collectPendingDigest,
  getNotificationMode,
  markDigestSent,
  setNotificationMode,
} from '@/lib/services/digest.service';
import { sweepAlerts } from '@/lib/services/alert.service';
import { createFakeAlertEventRepo, createFakeAlertRepo, createFakeNotificationPrefRepo, makeAlert } from './fakes';

const prices = (map: Record<string, number | null>) => async () => map;

describe('notification mode', () => {
  it('defaults to individual for a user who never chose', async () => {
    expect(await getNotificationMode('user-1', createFakeNotificationPrefRepo())).toBe('individual');
  });

  it('remembers a choice', async () => {
    const repo = createFakeNotificationPrefRepo();
    await setNotificationMode('user-1', 'digest', repo);
    expect(await getNotificationMode('user-1', repo)).toBe('digest');
  });

  it('preserves the digest marker when only the mode changes', async () => {
    const repo = createFakeNotificationPrefRepo();
    const at = new Date('2026-09-06T09:00:00Z');
    await setNotificationMode('user-1', 'digest', repo);
    await markDigestSent('user-1', at, repo);

    await setNotificationMode('user-1', 'individual', repo);
    expect((await repo.find('user-1'))!.lastDigestAt).toEqual(at);
  });

  it('keeps users independent', async () => {
    const repo = createFakeNotificationPrefRepo();
    await setNotificationMode('user-1', 'digest', repo);
    expect(await getNotificationMode('user-2', repo)).toBe('individual');
    expect(await repo.listByMode('digest')).toHaveLength(1);
  });

  it('falls back to individual if the lookup throws', async () => {
    const broken = {
      find: async () => {
        throw new Error('db down');
      },
      save: async () => {},
      listByMode: async () => [],
    };
    // The safe failure is still telling the user, just not bundled.
    expect(await getNotificationMode('user-1', broken)).toBe('individual');
  });
});

describe('collectPendingDigest', () => {
  const start = new Date('2026-09-06T09:00:00Z');
  const hoursLater = (h: number) => new Date(start.getTime() + h * 3_600_000);

  async function withCrossings() {
    const alerts = createFakeAlertRepo([
      makeAlert({ id: 'a1', symbol: 'NVDA', direction: 'buy', threshold: 165 }),
      makeAlert({ id: 'a2', symbol: 'TSLA', direction: 'sell', threshold: 350 }),
    ]);
    const events = createFakeAlertEventRepo();
    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 164, TSLA: 355 }), now: start });
    return events;
  }

  it('gathers everything since the last digest', async () => {
    const events = await withCrossings();
    const pending = await collectPendingDigest(
      { userId: 'user-1', mode: 'digest', lastDigestAt: new Date(start.getTime() - 60_000) },
      hoursLater(1),
      events
    );

    expect(pending).not.toBeNull();
    expect(pending!.events).toHaveLength(2);
    expect(pending!.summary.totalCrossings).toBe(2);
    expect(pending!.summary.headline).toContain('2 price alerts were triggered');
  });

  it('sends nothing when nothing has fired', async () => {
    const events = createFakeAlertEventRepo();
    const pending = await collectPendingDigest(
      { userId: 'user-1', mode: 'digest', lastDigestAt: start },
      hoursLater(1),
      events
    );
    expect(pending).toBeNull();
  });

  it('does not repeat crossings already covered by an earlier digest', async () => {
    const events = await withCrossings();
    const preference = { userId: 'user-1', mode: 'digest' as const, lastDigestAt: hoursLater(2) };

    // Everything fired before the last digest, so there is nothing left to send.
    expect(await collectPendingDigest(preference, hoursLater(3), events)).toBeNull();
  });

  it('reaches back a day on a first-ever digest', async () => {
    const events = await withCrossings();
    const pending = await collectPendingDigest(
      { userId: 'user-1', mode: 'digest', lastDigestAt: null },
      hoursLater(1),
      events
    );
    expect(pending!.events).toHaveLength(2);
  });
});

describe('digest mode changes delivery, never history', () => {
  it('still records a crossing in history when the email is suppressed', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();
    const notify = vi.fn(async () => {
      // Stands in for the poller's digest-mode check: deliver nothing now.
    });

    const result = await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 164 }) });

    expect(result.triggered).toBe(1);
    // The crossing is durable even though no individual email went out.
    expect(await events.listByUser('user-1', 25)).toHaveLength(1);
    // And it is still available to bundle later.
    const pending = await collectPendingDigest(
      { userId: 'user-1', mode: 'digest', lastDigestAt: null },
      new Date(),
      events
    );
    expect(pending!.summary.totalCrossings).toBe(1);
  });

  it('still disarms the alert, so a digest user is not spammed either', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();

    for (const price of [166, 165, 164, 163]) {
      await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: price }) });
    }

    expect(await events.listByUser('user-1', 25)).toHaveLength(1);
  });
});
