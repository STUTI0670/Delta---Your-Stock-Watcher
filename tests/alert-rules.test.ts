import { describe, expect, it } from 'vitest';
import {
  buildAlertMessage,
  evaluateAlert,
  isThresholdCrossed,
  rearmPrice,
  shouldRearm,
  type EvaluableAlert,
} from '@/lib/market/alert-rules';
import { ALERT_MIN_RENOTIFY_MS } from '@/lib/market/config';

const buyAlert = (overrides: Partial<EvaluableAlert> = {}): EvaluableAlert => ({
  direction: 'buy',
  threshold: 165,
  isEnabled: true,
  isArmed: true,
  lastTriggeredAt: null,
  ...overrides,
});

const sellAlert = (overrides: Partial<EvaluableAlert> = {}): EvaluableAlert => ({
  direction: 'sell',
  threshold: 200,
  isEnabled: true,
  isArmed: true,
  lastTriggeredAt: null,
  ...overrides,
});

describe('isThresholdCrossed', () => {
  it('crosses a buy threshold at or below the price', () => {
    expect(isThresholdCrossed('buy', 165, 166)).toBe(false);
    expect(isThresholdCrossed('buy', 165, 165)).toBe(true);
    expect(isThresholdCrossed('buy', 165, 164)).toBe(true);
  });

  it('crosses a sell threshold at or above the price', () => {
    expect(isThresholdCrossed('sell', 200, 199)).toBe(false);
    expect(isThresholdCrossed('sell', 200, 200)).toBe(true);
    expect(isThresholdCrossed('sell', 200, 201)).toBe(true);
  });
});

describe('buy threshold triggering', () => {
  it('does not fire above the threshold', () => {
    const result = evaluateAlert(buyAlert(), 166);
    expect(result.outcome).toBe('idle');
    expect(result.shouldNotify).toBe(false);
  });

  it('fires exactly at the threshold and disarms', () => {
    const result = evaluateAlert(buyAlert(), 165);
    expect(result.outcome).toBe('trigger');
    expect(result.shouldNotify).toBe(true);
    expect(result.nextArmed).toBe(false);
  });

  it('fires below the threshold when still armed', () => {
    const result = evaluateAlert(buyAlert(), 160);
    expect(result.outcome).toBe('trigger');
  });
});

describe('sell threshold triggering', () => {
  it('does not fire below the threshold', () => {
    expect(evaluateAlert(sellAlert(), 199).outcome).toBe('idle');
  });

  it('fires at and above the threshold', () => {
    expect(evaluateAlert(sellAlert(), 200).shouldNotify).toBe(true);
    expect(evaluateAlert(sellAlert(), 210).shouldNotify).toBe(true);
  });
});

describe('duplicate notification prevention', () => {
  it('follows the $166 -> $165 -> $164 -> $163 sequence with exactly one alert', () => {
    let alert = buyAlert();
    const notifications: number[] = [];

    for (const price of [166, 165, 164, 163]) {
      const result = evaluateAlert(alert, price);
      if (result.shouldNotify) notifications.push(price);
      alert = { ...alert, isArmed: result.nextArmed, lastTriggeredAt: result.shouldNotify ? new Date() : alert.lastTriggeredAt };
    }

    expect(notifications).toEqual([165]);
  });

  it('stays silent on repeated sweeps while price sits past the threshold', () => {
    const fired = buyAlert({ isArmed: false });
    for (const price of [164, 163, 160, 150]) {
      const result = evaluateAlert(fired, price);
      expect(result.shouldNotify).toBe(false);
      expect(result.outcome).toBe('idle');
    }
  });

  it('does not re-fire for a sell alert that stays above its threshold', () => {
    const fired = sellAlert({ isArmed: false });
    for (const price of [201, 205, 220]) {
      expect(evaluateAlert(fired, price).shouldNotify).toBe(false);
    }
  });
});

describe('re-arming', () => {
  it('requires the price to clear the buffer, not merely the threshold', () => {
    expect(rearmPrice('buy', 165)).toBeCloseTo(168.3, 5);
    expect(shouldRearm('buy', 165, 166)).toBe(false);
    expect(shouldRearm('buy', 165, 168.3)).toBe(false);
    expect(shouldRearm('buy', 165, 169)).toBe(true);
  });

  it('re-arms a buy alert once price recovers well above the threshold', () => {
    const result = evaluateAlert(buyAlert({ isArmed: false }), 170);
    expect(result.outcome).toBe('rearm');
    expect(result.nextArmed).toBe(true);
    expect(result.shouldNotify).toBe(false);
  });

  it('re-arms a sell alert once price falls well below the threshold', () => {
    expect(rearmPrice('sell', 200)).toBeCloseTo(196, 5);
    const result = evaluateAlert(sellAlert({ isArmed: false }), 190);
    expect(result.outcome).toBe('rearm');
    expect(result.nextArmed).toBe(true);
  });

  it('fires again only after a genuine re-arm and re-cross', () => {
    let alert = buyAlert();
    const notifications: number[] = [];

    // Fire, drift below, recover clear, then fall back through the threshold.
    for (const price of [165, 162, 175, 164]) {
      const result = evaluateAlert(alert, price, new Date(Date.now() + ALERT_MIN_RENOTIFY_MS + 1000));
      if (result.shouldNotify) notifications.push(price);
      alert = { ...alert, isArmed: result.nextArmed };
    }

    expect(notifications).toEqual([165, 164]);
  });

  it('suppresses a second notification inside the cooldown window', () => {
    const now = new Date('2026-09-06T10:00:00Z');
    const recent = new Date(now.getTime() - 60_000);
    const result = evaluateAlert(buyAlert({ lastTriggeredAt: recent }), 160, now);

    expect(result.shouldNotify).toBe(false);
    expect(result.reason).toContain('cooldown');
  });

  it('allows a notification once the cooldown has elapsed', () => {
    const now = new Date('2026-09-06T10:00:00Z');
    const old = new Date(now.getTime() - ALERT_MIN_RENOTIFY_MS - 1000);
    expect(evaluateAlert(buyAlert({ lastTriggeredAt: old }), 160, now).shouldNotify).toBe(true);
  });
});

describe('enable / disable', () => {
  it('never notifies while disabled, even when the threshold is crossed', () => {
    const result = evaluateAlert(buyAlert({ isEnabled: false }), 150);
    expect(result.shouldNotify).toBe(false);
    expect(result.reason).toBe('Alert is disabled.');
  });

  it('keeps tracking re-arm state while disabled so re-enabling is not a false fire', () => {
    const result = evaluateAlert(buyAlert({ isEnabled: false, isArmed: false }), 175);
    expect(result.outcome).toBe('rearm');
    expect(result.nextArmed).toBe(true);
    expect(result.shouldNotify).toBe(false);
  });

  it('fires normally after being re-enabled', () => {
    expect(evaluateAlert(buyAlert({ isEnabled: true, isArmed: true }), 165).shouldNotify).toBe(true);
  });
});

describe('missing price data', () => {
  it('is inert when no price is available', () => {
    for (const price of [null, undefined, Number.NaN]) {
      const result = evaluateAlert(buyAlert(), price as number | null);
      expect(result.outcome).toBe('idle');
      expect(result.shouldNotify).toBe(false);
      expect(result.nextArmed).toBe(true);
    }
  });
});

describe('buildAlertMessage', () => {
  it('describes a buy crossing', () => {
    expect(buildAlertMessage('NVDA', 'buy', 165, 164.5)).toBe(
      'NVDA fell to $164.50, crossing your buy threshold of $165.00.'
    );
  });

  it('describes a sell crossing', () => {
    expect(buildAlertMessage('TSLA', 'sell', 350, 352.1)).toBe(
      'TSLA rose to $352.10, crossing your sell threshold of $350.00.'
    );
  });
});
