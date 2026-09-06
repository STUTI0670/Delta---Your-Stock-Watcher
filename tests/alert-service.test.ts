import { describe, expect, it, vi } from 'vitest';
import {
  createAlert,
  deleteAlert,
  listAlertHistory,
  listAlerts,
  setAlertEnabled,
  sweepAlerts,
  updateAlert,
} from '@/lib/services/alert.service';
import { createFakeAlertEventRepo, createFakeAlertRepo, makeAlert } from './fakes';

const prices = (map: Record<string, number | null>) => async () => map;

describe('alert CRUD', () => {
  it('creates an alert that starts enabled and armed', async () => {
    const repo = createFakeAlertRepo();
    const alert = await createAlert(
      { userId: 'user-1', symbol: 'nvda', company: 'NVIDIA Corp', direction: 'buy', threshold: 165 },
      repo
    );

    expect(alert.symbol).toBe('NVDA');
    expect(alert.isEnabled).toBe(true);
    expect(alert.isArmed).toBe(true);
    expect(await listAlerts('user-1', repo)).toHaveLength(1);
  });

  it('rejects a non-positive threshold', async () => {
    const repo = createFakeAlertRepo();
    const base = { userId: 'user-1', symbol: 'NVDA', company: 'NVIDIA Corp', direction: 'buy' as const };

    await expect(createAlert({ ...base, threshold: 0 }, repo)).rejects.toThrow('positive');
    await expect(createAlert({ ...base, threshold: -5 }, repo)).rejects.toThrow('positive');
    await expect(createAlert({ ...base, threshold: Number.NaN }, repo)).rejects.toThrow('positive');
  });

  it('edits the threshold and re-arms, so the new condition can fire', async () => {
    const repo = createFakeAlertRepo([makeAlert({ isArmed: false })]);
    const updated = await updateAlert('user-1', 'alert-1', { threshold: 150 }, repo);

    expect(updated!.threshold).toBe(150);
    expect(updated!.isArmed).toBe(true);
  });

  it('clears the cooldown on an edit so the new threshold is not muted by the old crossing', async () => {
    const alerts = createFakeAlertRepo([
      makeAlert({ isArmed: false, lastTriggeredAt: new Date(), lastTriggeredPrice: 165 }),
    ]);
    const events = createFakeAlertEventRepo();

    await updateAlert('user-1', 'alert-1', { threshold: 155 }, alerts);
    expect(alerts.all()[0].lastTriggeredAt).toBeNull();

    const result = await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 150 }) });
    expect(result.triggered).toBe(1);
  });

  it('does not re-arm when only toggling enabled state', async () => {
    const repo = createFakeAlertRepo([makeAlert({ isArmed: false })]);
    const updated = await setAlertEnabled('user-1', 'alert-1', false, repo);

    expect(updated!.isEnabled).toBe(false);
    expect(updated!.isArmed).toBe(false);
  });

  it('enables and disables an alert', async () => {
    const repo = createFakeAlertRepo([makeAlert()]);

    expect((await setAlertEnabled('user-1', 'alert-1', false, repo))!.isEnabled).toBe(false);
    expect((await setAlertEnabled('user-1', 'alert-1', true, repo))!.isEnabled).toBe(true);
  });

  it('deletes an alert', async () => {
    const repo = createFakeAlertRepo([makeAlert()]);

    expect(await deleteAlert('user-1', 'alert-1', repo)).toBe(true);
    expect(await listAlerts('user-1', repo)).toHaveLength(0);
  });

  it('will not let one user delete or edit another user alert', async () => {
    const repo = createFakeAlertRepo([makeAlert()]);

    expect(await deleteAlert('intruder', 'alert-1', repo)).toBe(false);
    expect(await updateAlert('intruder', 'alert-1', { threshold: 1 }, repo)).toBeNull();
    expect(await listAlerts('user-1', repo)).toHaveLength(1);
  });
});

describe('sweepAlerts — triggering and notification', () => {
  it('triggers a buy alert, notifies once, and records history', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();
    const notify = vi.fn().mockResolvedValue(undefined);

    const result = await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 165 }) });

    expect(result.triggered).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);

    const history = await listAlertHistory('user-1', 25, events);
    expect(history).toHaveLength(1);
    expect(history[0].symbol).toBe('NVDA');
    expect(history[0].triggeredPrice).toBe(165);
    expect(history[0].message).toContain('crossing your buy threshold');
    expect(history[0].notifiedAt).not.toBeNull();

    // The alert is disarmed and stamped after firing.
    const stored = alerts.all()[0];
    expect(stored.isArmed).toBe(false);
    expect(stored.lastTriggeredPrice).toBe(165);
  });

  it('triggers a sell alert when price rises through the threshold', async () => {
    const alerts = createFakeAlertRepo([makeAlert({ direction: 'sell', threshold: 200 })]);
    const events = createFakeAlertEventRepo();

    const result = await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 205 }) });

    expect(result.triggered).toBe(1);
    expect((await listAlertHistory('user-1', 25, events))[0].direction).toBe('sell');
  });

  it('does not notify repeatedly across sweeps while price stays past the threshold', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();
    const notify = vi.fn().mockResolvedValue(undefined);

    for (const price of [166, 165, 164, 163]) {
      await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: price }) });
    }

    expect(notify).toHaveBeenCalledTimes(1);
    expect(await listAlertHistory('user-1', 25, events)).toHaveLength(1);
  });

  it('notifies again only after the price recovers and crosses back', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();
    const notify = vi.fn().mockResolvedValue(undefined);
    const start = new Date('2026-09-06T09:00:00Z');
    const hoursLater = (h: number) => new Date(start.getTime() + h * 3_600_000);

    await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 165 }), now: start });
    await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 160 }), now: hoursLater(1) });
    // Recovers clear of the re-arm buffer.
    await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 180 }), now: hoursLater(8) });
    expect(alerts.all()[0].isArmed).toBe(true);
    // Falls back through the threshold.
    await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 164 }), now: hoursLater(9) });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(await listAlertHistory('user-1', 25, events)).toHaveLength(2);
  });

  it('never fires a disabled alert', async () => {
    const alerts = createFakeAlertRepo([makeAlert({ isEnabled: false })]);
    const events = createFakeAlertEventRepo();
    const notify = vi.fn().mockResolvedValue(undefined);

    const result = await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 100 }) });

    expect(result.triggered).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(await listAlertHistory('user-1', 25, events)).toHaveLength(0);
  });

  it('fires a re-enabled alert on the next sweep', async () => {
    const alerts = createFakeAlertRepo([makeAlert({ isEnabled: false })]);
    const events = createFakeAlertEventRepo();

    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 160 }) });
    expect(alerts.all()[0].isArmed).toBe(true);

    await setAlertEnabled('user-1', 'alert-1', true, alerts);
    const result = await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 160 }) });

    expect(result.triggered).toBe(1);
  });

  it('stops evaluating an alert once it is deleted', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();

    await deleteAlert('user-1', 'alert-1', alerts);
    const result = await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 100 }) });

    expect(result.evaluated).toBe(0);
    expect(result.triggered).toBe(0);
  });

  it('skips symbols with no price and leaves them armed', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();

    const result = await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: null }) });

    expect(result.triggered).toBe(0);
    expect(alerts.all()[0].isArmed).toBe(true);
  });

  it('records the event and the delivery failure when notification throws', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();
    const notify = vi.fn().mockRejectedValue(new Error('SMTP unavailable'));

    const result = await sweepAlerts({ alerts, events, notify, getPrices: prices({ NVDA: 165 }) });

    expect(result.triggered).toBe(1);
    const history = await listAlertHistory('user-1', 25, events);
    expect(history[0].notifiedAt).toBeNull();
    expect(history[0].notificationError).toBe('SMTP unavailable');

    // Still disarmed, so a failed send cannot become a retry storm.
    expect(alerts.all()[0].isArmed).toBe(false);
  });

  it('evaluates alerts for multiple users independently', async () => {
    const alerts = createFakeAlertRepo([
      makeAlert({ id: 'alert-1', userId: 'user-1', symbol: 'NVDA', threshold: 165 }),
      makeAlert({ id: 'alert-2', userId: 'user-2', symbol: 'TSLA', direction: 'sell', threshold: 350 }),
    ]);
    const events = createFakeAlertEventRepo();

    const result = await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 164, TSLA: 355 }) });

    expect(result.triggered).toBe(2);
    expect(await listAlertHistory('user-1', 25, events)).toHaveLength(1);
    expect(await listAlertHistory('user-2', 25, events)).toHaveLength(1);
  });
});

describe('alert history persistence', () => {
  it('survives independently of the alert that produced it', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();

    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 165 }) });
    await deleteAlert('user-1', 'alert-1', alerts);

    const history = await listAlertHistory('user-1', 25, events);
    expect(history).toHaveLength(1);
    expect(history[0].symbol).toBe('NVDA');
  });

  it('returns newest first and honours the limit', async () => {
    const alerts = createFakeAlertRepo([makeAlert()]);
    const events = createFakeAlertEventRepo();
    const start = new Date('2026-09-06T09:00:00Z');
    const hoursLater = (h: number) => new Date(start.getTime() + h * 3_600_000);

    // Three separate crossings, each with a re-arm in between.
    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 165 }), now: start });
    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 180 }), now: hoursLater(7) });
    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 164 }), now: hoursLater(8) });
    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 180 }), now: hoursLater(15) });
    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 163 }), now: hoursLater(16) });

    const all = await listAlertHistory('user-1', 25, events);
    expect(all).toHaveLength(3);
    expect(all[0].triggeredAt.getTime()).toBeGreaterThan(all[1].triggeredAt.getTime());

    expect(await listAlertHistory('user-1', 2, events)).toHaveLength(2);
  });

  it('does not leak history between users', async () => {
    const events = createFakeAlertEventRepo();
    const alerts = createFakeAlertRepo([makeAlert({ userId: 'user-1' })]);

    await sweepAlerts({ alerts, events, getPrices: prices({ NVDA: 165 }) });

    expect(await listAlertHistory('user-2', 25, events)).toHaveLength(0);
  });
});
