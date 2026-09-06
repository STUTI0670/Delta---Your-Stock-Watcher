/**
 * Monitoring cadence — how often a watched stock is worth *checking on*.
 *
 * This is explicitly a recommendation about the user's attention, not about
 * their money. It is derived only from observed variability — how much a symbol
 * moves, how often it moves a lot, how often it trips the user's own alerts —
 * and never considers valuation, direction or outlook.
 *
 * The distinction is enforced in the vocabulary: this module can only ever emit
 * "check more often" / "check as usual" / "check less often". There is no code
 * path that produces a buy or sell opinion.
 *
 * Pure: no React, no database, no network.
 */

import {
  CADENCE_FREQUENT_CROSSINGS,
  CADENCE_FREQUENT_LARGE_MOVES,
  CADENCE_HIGH_AVG_MOVE_PCT,
  CADENCE_LOW_AVG_MOVE_PCT,
  LARGE_DAILY_MOVE_PCT,
} from '@/lib/market/config';
import { describeBehavior, type PriceBehavior } from '@/lib/market/price-behavior';

export type Cadence = 'more-often' | 'as-usual' | 'less-often' | 'unknown';

export interface CadenceRecommendation {
  symbol: string;
  cadence: Cadence;
  /** Short label for the badge. */
  label: string;
  /** The measured statement behind the recommendation. */
  rationale: string;
  /** Individual measurements that drove it, for transparency. */
  drivers: string[];
  averageAbsDailyMovePct: number | null;
  largeMoveCount: number;
  sessions: number;
  thresholdCrossings: number;
}

export function cadenceLabel(cadence: Cadence): string {
  switch (cadence) {
    case 'more-often':
      return 'Check more often';
    case 'less-often':
      return 'Check less often';
    case 'as-usual':
      return 'Check as usual';
    default:
      return 'Not enough history';
  }
}

export interface CadenceInput {
  symbol: string;
  behavior: PriceBehavior;
  /** How many times this symbol tripped the user's own alerts recently. */
  thresholdCrossings?: number;
}

/**
 * Decide how closely a symbol needs watching.
 *
 * A stock earns more of the user's attention if it moves a lot on an average
 * day, if it has produced several large moves recently, or if it keeps reaching
 * thresholds the user set themselves.
 */
export function recommendCadence({
  symbol,
  behavior,
  thresholdCrossings = 0,
}: CadenceInput): CadenceRecommendation {
  const base = {
    symbol,
    averageAbsDailyMovePct: behavior.averageAbsDailyMovePct,
    largeMoveCount: behavior.largeMoveCount,
    sessions: behavior.sessions,
    thresholdCrossings,
  };

  if (!behavior.hasEnoughData || behavior.averageAbsDailyMovePct === null) {
    return {
      ...base,
      cadence: 'unknown',
      label: cadenceLabel('unknown'),
      rationale: describeBehavior(behavior),
      drivers: [],
    };
  }

  const average = behavior.averageAbsDailyMovePct;
  const drivers: string[] = [`Average daily movement: ${average.toFixed(1)}%.`];

  if (behavior.largeMoveCount > 0) {
    const times = behavior.largeMoveCount === 1 ? 'once' : `${behavior.largeMoveCount} times`;
    drivers.push(`Moved ${LARGE_DAILY_MOVE_PCT}% or more ${times} in the last ${behavior.sessions} sessions.`);
  } else {
    drivers.push(`No moves of ${LARGE_DAILY_MOVE_PCT}% or more in the last ${behavior.sessions} sessions.`);
  }

  if (thresholdCrossings > 0) {
    drivers.push(
      `Reached ${thresholdCrossings} of your price ${thresholdCrossings === 1 ? 'alert' : 'alerts'} recently.`
    );
  }

  const movesALot = average >= CADENCE_HIGH_AVG_MOVE_PCT;
  const jumpsOften = behavior.largeMoveCount >= CADENCE_FREQUENT_LARGE_MOVES;
  const tripsAlerts = thresholdCrossings >= CADENCE_FREQUENT_CROSSINGS;

  if (movesALot || jumpsOften || tripsAlerts) {
    return {
      ...base,
      cadence: 'more-often',
      label: cadenceLabel('more-often'),
      rationale: describeBehavior(behavior),
      drivers,
    };
  }

  const isQuiet =
    average <= CADENCE_LOW_AVG_MOVE_PCT && behavior.largeMoveCount === 0 && thresholdCrossings === 0;

  return {
    ...base,
    cadence: isQuiet ? 'less-often' : 'as-usual',
    label: cadenceLabel(isQuiet ? 'less-often' : 'as-usual'),
    rationale: describeBehavior(behavior),
    drivers,
  };
}

/**
 * Rank a watchlist by how much monitoring it warrants: busiest first, quietest
 * last, and symbols we cannot describe at the end.
 */
export function rankByCadence(recommendations: CadenceRecommendation[]): CadenceRecommendation[] {
  const order: Record<Cadence, number> = { 'more-often': 0, 'as-usual': 1, 'less-often': 2, unknown: 3 };

  return [...recommendations].sort((a, b) => {
    if (order[a.cadence] !== order[b.cadence]) return order[a.cadence] - order[b.cadence];
    return (b.averageAbsDailyMovePct ?? 0) - (a.averageAbsDailyMovePct ?? 0);
  });
}
