/**
 * Pure price-alert evaluation.
 *
 * The whole anti-spam design lives here, and it is deliberately a pure state
 * machine so it can be tested exhaustively without a database or a scheduler:
 *
 *   armed + threshold crossed  -> FIRE, then disarm
 *   disarmed + still beyond    -> stay silent
 *   disarmed + price recovered past the re-arm buffer -> RE-ARM (silently)
 *
 * A buy alert at $165 therefore fires once at $165 and stays quiet at $164 and
 * $163. It only becomes eligible again once price climbs back above $168.30
 * (165 + 2%), which also prevents a price oscillating on the threshold from
 * producing a burst of notifications.
 */

import { ALERT_MIN_RENOTIFY_MS, ALERT_REARM_BUFFER_PCT } from '@/lib/market/config';
import { currencyForSymbol, formatMoney } from '@/lib/market/currency';

export type AlertDirection = 'buy' | 'sell';

export interface EvaluableAlert {
  direction: AlertDirection;
  threshold: number;
  isEnabled: boolean;
  isArmed: boolean;
  lastTriggeredAt?: Date | string | null;
}

export type AlertOutcome = 'trigger' | 'rearm' | 'idle';

export interface AlertEvaluation {
  outcome: AlertOutcome;
  /** Whether a notification should be sent for this evaluation. */
  shouldNotify: boolean;
  /** The value `isArmed` must hold after this evaluation. */
  nextArmed: boolean;
  reason: string;
}

/**
 * True when the live price satisfies the user's threshold condition.
 * Buy: price at or below the threshold. Sell: price at or above it.
 */
export function isThresholdCrossed(direction: AlertDirection, threshold: number, price: number): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(threshold)) return false;
  return direction === 'buy' ? price <= threshold : price >= threshold;
}

/**
 * The price a disarmed alert must reach before it becomes eligible again.
 * Sits on the opposite side of the threshold from the trigger condition.
 */
export function rearmPrice(direction: AlertDirection, threshold: number): number {
  const buffer = threshold * (ALERT_REARM_BUFFER_PCT / 100);
  return direction === 'buy' ? threshold + buffer : threshold - buffer;
}

/** True when price has recovered far enough for the alert to re-arm. */
export function shouldRearm(direction: AlertDirection, threshold: number, price: number): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(threshold)) return false;
  const target = rearmPrice(direction, threshold);
  return direction === 'buy' ? price > target : price < target;
}

/**
 * Decide what happens to one alert given the current price.
 * `now` is injectable so the cooldown branch is testable.
 */
export function evaluateAlert(alert: EvaluableAlert, price: number | null | undefined, now: Date = new Date()): AlertEvaluation {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return {
      outcome: 'idle',
      shouldNotify: false,
      nextArmed: alert.isArmed,
      reason: 'No usable price for this symbol.',
    };
  }

  // A disabled alert never fires, but it must still track re-arming so that
  // re-enabling it later does not immediately fire on a stale armed state.
  if (!alert.isEnabled) {
    const rearmed = !alert.isArmed && shouldRearm(alert.direction, alert.threshold, price);
    return {
      outcome: rearmed ? 'rearm' : 'idle',
      shouldNotify: false,
      nextArmed: rearmed ? true : alert.isArmed,
      reason: 'Alert is disabled.',
    };
  }

  const crossed = isThresholdCrossed(alert.direction, alert.threshold, price);

  if (!alert.isArmed) {
    if (shouldRearm(alert.direction, alert.threshold, price)) {
      return {
        outcome: 'rearm',
        shouldNotify: false,
        nextArmed: true,
        reason: 'Price recovered clear of the threshold; alert re-armed.',
      };
    }
    return {
      outcome: 'idle',
      shouldNotify: false,
      nextArmed: false,
      reason: 'Already notified for this crossing.',
    };
  }

  if (!crossed) {
    return {
      outcome: 'idle',
      shouldNotify: false,
      nextArmed: true,
      reason: 'Threshold not reached.',
    };
  }

  // Armed and crossed — but hold a hard floor between notifications as a second
  // line of defence against a re-arm/re-trigger flapping loop.
  const lastTriggeredAt = alert.lastTriggeredAt ? new Date(alert.lastTriggeredAt) : null;
  if (lastTriggeredAt && !Number.isNaN(lastTriggeredAt.getTime())) {
    const elapsed = now.getTime() - lastTriggeredAt.getTime();
    if (elapsed < ALERT_MIN_RENOTIFY_MS) {
      return {
        outcome: 'idle',
        shouldNotify: false,
        nextArmed: false,
        reason: 'Within the cooldown window since the last notification.',
      };
    }
  }

  return {
    outcome: 'trigger',
    shouldNotify: true,
    nextArmed: false,
    reason: 'Threshold reached.',
  };
}

/** The sentence shown in the alert history and sent in the notification. */
export function buildAlertMessage(
  symbol: string,
  direction: AlertDirection,
  threshold: number,
  price: number
): string {
  const verb = direction === 'buy' ? 'fell to' : 'rose to';
  const currency = currencyForSymbol(symbol);
  return `${symbol} ${verb} ${formatMoney(price, currency)}, crossing your ${direction} threshold of ${formatMoney(threshold, currency)}.`;
}
