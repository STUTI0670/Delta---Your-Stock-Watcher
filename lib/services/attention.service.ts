/**
 * Attention service — assembles the answer to
 * "what meaningfully changed since I last checked?".
 *
 * The one place that orchestrates checkpoint reads, market data, volume
 * baselines and news counts, then applies the deterministic P1 change rules.
 * It is careful to advance the checkpoint only once the comparison has been
 * successfully built.
 */

import { detectWatchlistChanges, type SymbolChange } from '@/lib/market/change-detection';
import {
  computeAttentionScore,
  contributingFactors,
  type AttentionFactor,
  type AttentionScore,
  type SignalWeights,
} from '@/lib/market/attention-score';
import { isPersonalized } from '@/lib/market/personalization';
import { baselineLevel, combineLevels } from '@/lib/market/attention-level';
import { buildSymbolInsights, countThresholdCrossings, type SymbolInsight } from '@/lib/services/insight.service';
import { getSignalWeights } from '@/lib/services/feedback.service';
import { computeVolumeBaseline, sparklineSeries, type VolumeBaseline } from '@/lib/market/volume';
import { fetchSymbols } from '@/lib/market/providers/yahoo';
import type { SymbolData } from '@/lib/market/types';
import type { DailyBar } from '@/lib/market/yahoo-parse';
import { listWatchlist } from '@/lib/services/watchlist.service';
import { countNewsSince } from '@/lib/services/news.service';
import { mongoAlertEventRepository } from '@/lib/services/repositories';
import {
  commitCheckpoint,
  getCheckpoint,
  indexSnapshots,
  shouldAdvanceCheckpoint,
} from '@/lib/services/checkpoint.service';

/**
 * How much of the user's attention a change has earned.
 *
 * Derived directly from the P1 severity rule — no scoring model, no weighting.
 * `large` moves are critical, `notable` moves are worth watching, and a symbol
 * that is otherwise flat is only promoted to "worth watching" by an unusual
 * volume session, which P1.2 permits when reliable data exists.
 */
export type AttentionLevel = 'critical' | 'watch' | 'normal';

export interface WatchlistChange extends SymbolChange {
  level: AttentionLevel;
  volume: VolumeBaseline | null;
  /** Normalised closes for the sparkline, oldest first. */
  sparkline: number[];
  historyError: string | null;
  /** P2: the attention score and the factors that justify it. */
  score: AttentionScore;
  /** Only the factors that actually contributed, strongest first. */
  whyFactors: AttentionFactor[];
  /** How this stock normally behaves, and how often to check it. */
  insight: SymbolInsight | null;
  thresholdCrossings: number;
}

export interface AttentionReport {
  /** The checkpoint this report was measured against; null on a first visit. */
  comparedTo: Date | null;
  isFirstCheck: boolean;
  changes: WatchlistChange[];
  needsAttention: WatchlistChange[];
  /** Alerts that fired since the last checkpoint. */
  thresholdsReached: number;
  /** True when the market-data provider failed for every watched symbol. */
  dataUnavailable: boolean;
  degradedSymbols: string[];
  newsUnavailable: boolean;
  /** P2: monitoring-cadence recommendations, busiest first. */
  insights: SymbolInsight[];
  /** The user's personalized signal weights, and whether they differ from neutral. */
  weights: Required<SignalWeights>;
  personalized: boolean;
}



const EMPTY_REPORT: AttentionReport = {
  comparedTo: null,
  isFirstCheck: true,
  changes: [],
  needsAttention: [],
  thresholdsReached: 0,
  dataUnavailable: false,
  degradedSymbols: [],
  newsUnavailable: false,
  insights: [],
  weights: { price: 1, volume: 1, event: 1, threshold: 1 },
  personalized: false,
};

export interface AttentionReportOptions {
  /**
   * Whether this run may move the baseline forward.
   *
   * A user opening the dashboard *is* the act of checking, so the checkpoint
   * should advance. A background job reading the same report on their behalf is
   * not — if the nightly briefing advanced the checkpoint, the user would open
   * the app minutes later and be told nothing had changed, because the job had
   * already consumed the very comparison it was reporting on. Jobs pass false.
   */
  advanceCheckpoint?: boolean;
}

export async function buildAttentionReport(
  userId: string,
  now: Date = new Date(),
  { advanceCheckpoint = true }: AttentionReportOptions = {}
): Promise<AttentionReport> {
  const watchlist = await listWatchlist(userId);
  if (watchlist.length === 0) return EMPTY_REPORT;

  // 1. Read the baseline BEFORE anything else touches it.
  const previousCheckpoint = await getCheckpoint(userId);
  const snapshots = indexSnapshots(previousCheckpoint);
  const symbols = watchlist.map((item) => item.symbol);

  // 2. Gather market state in parallel. Each source fails independently so one
  //    dead provider degrades one part of the page rather than blanking it.
  const [market, news, firedSinceCheckpoint, crossings, weights] = await Promise.all([
    fetchSymbols(symbols).catch((err) => {
      console.error('buildAttentionReport: market data fetch failed entirely', err);
      return {} as Record<string, SymbolData>;
    }),
    countNewsSince(symbols, previousCheckpoint?.checkedAt ?? null).catch((err) => {
      console.error('buildAttentionReport: news count failed', err);
      return { counts: {} as Record<string, number>, unavailable: true };
    }),
    previousCheckpoint
      ? mongoAlertEventRepository.listByUserSince(userId, previousCheckpoint.checkedAt).catch(() => [])
      : Promise.resolve([]),
    countThresholdCrossings(userId, now),
    getSignalWeights(userId, undefined, now),
  ]);

  const volumeBySymbol: Record<string, VolumeBaseline> = {};
  for (const item of watchlist) {
    const bars = market[item.symbol]?.bars ?? [];
    if (bars.length > 0) volumeBySymbol[item.symbol] = computeVolumeBaseline(item.symbol, bars);
  }

  // 3. Compare against the baseline.
  const detected = detectWatchlistChanges(
    watchlist.map((item) => {
      const quote = market[item.symbol]?.quote;
      const volume = volumeBySymbol[item.symbol];
      return {
        symbol: item.symbol,
        company: item.company,
        snapshot: snapshots[item.symbol] ?? null,
        newsCount: news.counts[item.symbol] ?? 0,
        quote: quote
          ? {
              symbol: item.symbol,
              price: quote.price,
              dayChangePercent: quote.dayChangePercent,
              currency: quote.currency,
              updatedAt: quote.updatedAt,
              stale: quote.stale,
              // A successful quote carries a null error; `??` would have
              // wrongly replaced that null with an error message.
              error: quote.error,
              volume: volume?.latestVolume ?? null,
            }
          : {
              symbol: item.symbol,
              price: null,
              dayChangePercent: null,
              currency: null,
              updatedAt: null,
              stale: true,
              error: 'Market data unavailable.',
            },
      };
    })
  );

  // P2: describe how each stock normally behaves, so a move can be judged
  // against its own norm rather than a single global threshold.
  const barsBySymbol: Record<string, DailyBar[]> = {};
  for (const item of watchlist) barsBySymbol[item.symbol] = market[item.symbol]?.bars ?? [];
  const insights = buildSymbolInsights({ watchlist, barsBySymbol, crossings });
  const insightBySymbol = insights.reduce<Record<string, SymbolInsight>>((acc, insight) => {
    acc[insight.symbol] = insight;
    return acc;
  }, {});

  const changes: WatchlistChange[] = detected.changes.map((change) => {
    const volume = volumeBySymbol[change.symbol] ?? null;
    const data = market[change.symbol];
    const insight = insightBySymbol[change.symbol] ?? null;
    const thresholdCrossings = crossings[change.symbol] ?? 0;

    const score = computeAttentionScore({
      changePercent: change.changePercent,
      behavior: insight?.behavior ?? null,
      volumeRatio: volume?.ratio ?? null,
      volumeUnavailable: !volume?.hasBaseline,
      newsCount: change.newsCount,
      newsUnavailable: news.unavailable,
      thresholdCrossings,
      weights,
    });

    return {
      ...change,
      level: combineLevels(baselineLevel(change.severity, Boolean(volume?.isUnusual)), score.band),
      volume,
      sparkline: sparklineSeries(data?.bars ?? []),
      historyError: data?.historyError ?? null,
      score,
      whyFactors: contributingFactors(score),
      insight,
      thresholdCrossings,
    };
  });

  // "Needs your attention" is always relative to a previous check. On a first
  // visit there is no "since", so nothing is surfaced however the market looks.
  // Ranked by score, with the raw move breaking ties.
  const needsAttention = (previousCheckpoint ? changes : [])
    .filter((change) => change.level !== 'normal')
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      return Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0);
    });

  const degradedSymbols = changes.filter((change) => change.currentPrice === null).map((change) => change.symbol);
  const dataUnavailable = degradedSymbols.length === watchlist.length;

  // 4. Only now advance the checkpoint — and only if the comparison window has
  //    actually elapsed, so a refresh does not wipe out what the user is reading.
  //    A run where no price could be fetched never advances the baseline.
  if (advanceCheckpoint && !dataUnavailable && shouldAdvanceCheckpoint(previousCheckpoint, now)) {
    try {
      await commitCheckpoint(
        userId,
        watchlist.map((item) => ({
          symbol: item.symbol,
          price: market[item.symbol]?.quote.price ?? null,
          updatedAt: market[item.symbol]?.quote.updatedAt ?? now,
        })),
        previousCheckpoint,
        now
      );
    } catch (err) {
      // A failed checkpoint write must not break the dashboard; the user simply
      // keeps their existing baseline until the next visit.
      console.error('buildAttentionReport: failed to advance checkpoint', err);
    }
  }

  return {
    comparedTo: previousCheckpoint?.checkedAt ?? null,
    isFirstCheck: !previousCheckpoint,
    changes,
    needsAttention,
    thresholdsReached: firedSinceCheckpoint.length,
    dataUnavailable,
    degradedSymbols,
    newsUnavailable: news.unavailable,
    insights,
    weights,
    personalized: isPersonalized(weights),
  };
}

/** Everything the stock detail page needs to answer "what changed?". */
export async function buildSymbolReport(userId: string, symbol: string): Promise<WatchlistChange | null> {
  const report = await buildAttentionReport(userId);
  return report.changes.find((change) => change.symbol === symbol.toUpperCase()) ?? null;
}
