/**
 * How a stock normally behaves, measured from its own recent history.
 *
 * Descriptive statistics over close-to-close returns — no forecasting, and no
 * opinion about value. These numbers exist to answer "how often is this worth
 * looking at?", never "should I own it?".
 *
 * Pure: no React, no database, no network.
 */

import { LARGE_DAILY_MOVE_PCT, MIN_SESSIONS_FOR_BEHAVIOR } from '@/lib/market/config';

export interface BehaviorBar {
  close: number;
  volume?: number | null;
}

export interface PriceBehavior {
  symbol: string;
  /** Number of close-to-close returns the statistics are based on. */
  sessions: number;
  /** True once there is enough history to describe anything. */
  hasEnoughData: boolean;
  /** Mean of |daily % move| — the headline "how much does this move" figure. */
  averageAbsDailyMovePct: number | null;
  /** Standard deviation of daily % returns: dispersion, not direction. */
  volatilityPct: number | null;
  /** Largest single-session absolute move in the window. */
  maxAbsDailyMovePct: number | null;
  /** Sessions that moved at least LARGE_DAILY_MOVE_PCT. */
  largeMoveCount: number;
}

/** Close-to-close percentage returns for a series of bars, oldest first. */
export function dailyReturns(bars: BehaviorBar[]): number[] {
  const returns: number[] = [];

  for (let i = 1; i < (bars?.length ?? 0); i++) {
    const previous = bars[i - 1]?.close;
    const current = bars[i]?.close;
    // Both closes must be real, positive prices. A zero or negative close is
    // bad data, not a session — treating one as real would manufacture a
    // -100% return and poison the volatility and average for the whole window.
    if (typeof previous !== 'number' || typeof current !== 'number') continue;
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    if (previous <= 0 || current <= 0) continue;
    returns.push(((current - previous) / previous) * 100);
  }

  return returns;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Population standard deviation. */
function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/**
 * Summarise one symbol's recent behaviour.
 *
 * Returns a "not enough data" shape rather than misleading statistics when the
 * history is too short — a two-day sample cannot describe a stock's character.
 */
export function computePriceBehavior(symbol: string, bars: BehaviorBar[]): PriceBehavior {
  const returns = dailyReturns(bars ?? []);

  if (returns.length < MIN_SESSIONS_FOR_BEHAVIOR) {
    return {
      symbol,
      sessions: returns.length,
      hasEnoughData: false,
      averageAbsDailyMovePct: null,
      volatilityPct: null,
      maxAbsDailyMovePct: null,
      largeMoveCount: 0,
    };
  }

  const absolute = returns.map(Math.abs);

  return {
    symbol,
    sessions: returns.length,
    hasEnoughData: true,
    averageAbsDailyMovePct: mean(absolute),
    volatilityPct: standardDeviation(returns),
    maxAbsDailyMovePct: Math.max(...absolute),
    largeMoveCount: absolute.filter((value) => value >= LARGE_DAILY_MOVE_PCT).length,
  };
}

/** One sentence describing the measured behaviour, for the interface. */
export function describeBehavior(behavior: PriceBehavior): string {
  if (!behavior.hasEnoughData) {
    return 'Not enough trading history yet to describe how this stock usually moves.';
  }

  const average = behavior.averageAbsDailyMovePct!.toFixed(1);

  if (behavior.largeMoveCount === 0) {
    return `Average daily movement: ${average}%. No large moves in the last ${behavior.sessions} sessions.`;
  }

  const times = behavior.largeMoveCount === 1 ? 'once' : `${behavior.largeMoveCount} times`;
  return `Average daily movement: ${average}%. Large movements occurred ${times} in the last ${behavior.sessions} trading sessions.`;
}
