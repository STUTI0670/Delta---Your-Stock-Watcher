/**
 * Insight service — "how does each watched stock normally behave, and how often
 * is it worth checking?".
 *
 * Orchestrates behaviour statistics, the user's own threshold crossings and the
 * cadence rules. Every failure degrades to "not enough history" rather than a
 * guess.
 */

import { CROSSING_LOOKBACK_DAYS } from '@/lib/market/config';
import { computePriceBehavior, type PriceBehavior } from '@/lib/market/price-behavior';
import { rankByCadence, recommendCadence, type CadenceRecommendation } from '@/lib/market/monitoring-cadence';
import type { DailyBar } from '@/lib/market/yahoo-parse';
import { mongoAlertEventRepository, type AlertEventRepository } from '@/lib/services/repositories';

export interface SymbolInsight {
  symbol: string;
  company: string;
  behavior: PriceBehavior;
  cadence: CadenceRecommendation;
}

/**
 * How many times each symbol tripped this user's own alerts recently.
 * Keyed by symbol; absent symbols simply have no crossings.
 */
export async function countThresholdCrossings(
  userId: string,
  now: Date = new Date(),
  repo: AlertEventRepository = mongoAlertEventRepository
): Promise<Record<string, number>> {
  if (!userId) return {};

  try {
    const since = new Date(now.getTime() - CROSSING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const events = await repo.listByUserSince(userId, since);

    return events.reduce<Record<string, number>>((acc, event) => {
      acc[event.symbol] = (acc[event.symbol] ?? 0) + 1;
      return acc;
    }, {});
  } catch (err) {
    console.error('countThresholdCrossings failed', err);
    return {};
  }
}

export interface BuildInsightsInput {
  watchlist: Array<{ symbol: string; company: string }>;
  /** Daily bars per symbol, already fetched by the caller. */
  barsBySymbol: Record<string, DailyBar[]>;
  crossings: Record<string, number>;
}

/**
 * Behaviour statistics and a monitoring-cadence recommendation per symbol,
 * ranked so the stocks needing the closest watch come first.
 */
export function buildSymbolInsights({
  watchlist,
  barsBySymbol,
  crossings,
}: BuildInsightsInput): SymbolInsight[] {
  const insights = watchlist.map((item) => {
    const behavior = computePriceBehavior(item.symbol, barsBySymbol[item.symbol] ?? []);
    return {
      symbol: item.symbol,
      company: item.company,
      behavior,
      cadence: recommendCadence({
        symbol: item.symbol,
        behavior,
        thresholdCrossings: crossings[item.symbol] ?? 0,
      }),
    };
  });

  const order = rankByCadence(insights.map((insight) => insight.cadence)).map((c) => c.symbol);
  return insights.sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
}
