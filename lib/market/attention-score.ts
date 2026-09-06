/**
 * Attention scoring — how much of the user's attention a stock has earned.
 *
 *   attentionScore = priceMovement + volume + event + threshold
 *
 * Two rules keep this honest and make "why am I seeing this?" free:
 *
 *   1. Every point that is added also records the factor that added it, with
 *      the real measurement behind it. There is no path that scores without
 *      explaining, so the explanation can never drift from the score.
 *   2. A component scores zero when its data is missing, rather than guessing,
 *      and says so. "We did not look" must never look like "nothing happened".
 *
 * Pure: no React, no database, no network.
 */

import { ATTENTION_BANDS, LARGE_PRICE_CHANGE_PCT, MEANINGFUL_PRICE_CHANGE_PCT } from '@/lib/market/config';
import type { PriceBehavior } from '@/lib/market/price-behavior';

export type AttentionBand = 'normal' | 'watch' | 'critical';

export type SignalKind = 'price' | 'volume' | 'event' | 'threshold';

export interface AttentionFactor {
  kind: SignalKind;
  /** Points contributed after personalization weighting. */
  points: number;
  /** Points before weighting, so the raw signal stays visible. */
  rawPoints: number;
  /** Plain-language statement of the measurement. */
  text: string;
  /** True when the signal could not be evaluated, as opposed to scoring zero. */
  unavailable?: boolean;
}

export interface AttentionScore {
  total: number;
  band: AttentionBand;
  factors: AttentionFactor[];
  /** Signals we could not evaluate, kept apart from genuine zeroes. */
  unavailableSignals: SignalKind[];
}

/** Per-signal multipliers derived from a user's feedback. Defaults to neutral. */
export type SignalWeights = Partial<Record<SignalKind, number>>;

export interface AttentionInput {
  /** % move since the user's last checkpoint. */
  changePercent: number | null;
  /** How the symbol normally behaves, to judge whether this move is unusual. */
  behavior?: PriceBehavior | null;
  /** Latest volume as a multiple of its own recent average. */
  volumeRatio?: number | null;
  /** True when volume could not be measured at all. */
  volumeUnavailable?: boolean;
  /** Stories published since the last checkpoint. */
  newsCount?: number;
  /** True when the news count could not be determined. */
  newsUnavailable?: boolean;
  /** The user's own alert thresholds this symbol crossed recently. */
  thresholdCrossings?: number;
  weights?: SignalWeights;
}

function signedPercent(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  if (rounded === 0) return '0.0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%`;
}

function weightFor(weights: SignalWeights | undefined, kind: SignalKind): number {
  const weight = weights?.[kind];
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1;
}

/**
 * Points for the size of the move since the last check, escalated when the move
 * is also unusual *for this particular stock*. A 3% day is routine for one
 * symbol and remarkable for another, and the score should say which.
 */
function scorePrice(changePercent: number | null, behavior: PriceBehavior | null | undefined): AttentionFactor {
  if (changePercent === null) {
    return {
      kind: 'price',
      points: 0,
      rawPoints: 0,
      text: 'No price comparison available since your last check.',
      unavailable: true,
    };
  }

  const magnitude = Math.abs(changePercent);
  let points = 0;
  if (magnitude >= LARGE_PRICE_CHANGE_PCT) points = 3;
  else if (magnitude >= MEANINGFUL_PRICE_CHANGE_PCT) points = 2;
  else if (magnitude >= MEANINGFUL_PRICE_CHANGE_PCT / 2) points = 1;

  let text = `Price moved ${signedPercent(changePercent)} since your last check.`;

  const typical = behavior?.hasEnoughData ? behavior.averageAbsDailyMovePct : null;
  if (points > 0 && typeof typical === 'number' && typical > 0) {
    const multiple = magnitude / typical;
    if (multiple >= 2) {
      points += 1;
      text += ` That is ${multiple.toFixed(1)}× its typical daily move of ${typical.toFixed(1)}%.`;
    }
  }

  return { kind: 'price', points, rawPoints: points, text };
}

function scoreVolume(ratio: number | null | undefined, unavailable: boolean): AttentionFactor {
  if (unavailable || typeof ratio !== 'number' || !Number.isFinite(ratio)) {
    return {
      kind: 'volume',
      points: 0,
      rawPoints: 0,
      text: 'Trading volume could not be measured for this stock.',
      unavailable: true,
    };
  }

  let points = 0;
  if (ratio >= 3) points = 2;
  else if (ratio >= 2) points = 1;

  const text =
    points > 0
      ? `Trading volume is ${ratio.toFixed(1)}× its recent daily average.`
      : `Trading volume is ${ratio.toFixed(1)}× its recent daily average, which is normal.`;

  return { kind: 'volume', points, rawPoints: points, text };
}

function scoreEvents(newsCount: number, unavailable: boolean): AttentionFactor {
  if (unavailable) {
    return {
      kind: 'event',
      points: 0,
      rawPoints: 0,
      text: 'Related news could not be checked right now.',
      unavailable: true,
    };
  }

  let points = 0;
  if (newsCount >= 3) points = 2;
  else if (newsCount >= 1) points = 1;

  const text =
    newsCount > 0
      ? `${newsCount} related ${newsCount === 1 ? 'story was' : 'stories were'} published since your last check.`
      : 'No related stories since your last check.';

  return { kind: 'event', points, rawPoints: points, text };
}

function scoreThresholds(crossings: number): AttentionFactor {
  const points = crossings > 0 ? Math.min(2, crossings) : 0;
  const text =
    crossings > 0
      ? `${crossings} of your price ${crossings === 1 ? 'alert was' : 'alerts were'} triggered recently.`
      : 'None of your price alerts were triggered.';

  return { kind: 'threshold', points, rawPoints: points, text };
}

export function bandFor(total: number): AttentionBand {
  if (total >= ATTENTION_BANDS.important) return 'critical';
  if (total >= ATTENTION_BANDS.worthWatching) return 'watch';
  return 'normal';
}

/** Score one symbol and, in the same pass, produce the factors that justify it. */
export function computeAttentionScore({
  changePercent,
  behavior,
  volumeRatio,
  volumeUnavailable = false,
  newsCount = 0,
  newsUnavailable = false,
  thresholdCrossings = 0,
  weights,
}: AttentionInput): AttentionScore {
  const raw = [
    scorePrice(changePercent, behavior),
    scoreVolume(volumeRatio, volumeUnavailable),
    scoreEvents(newsCount, newsUnavailable),
    scoreThresholds(thresholdCrossings),
  ];

  // Personalization scales what a signal is worth to this user, but only for
  // signals that actually fired; it never invents or erases a measurement.
  const factors = raw.map((factor) => ({
    ...factor,
    points:
      factor.rawPoints === 0 ? 0 : Math.round(factor.rawPoints * weightFor(weights, factor.kind) * 100) / 100,
  }));

  const total = Math.round(factors.reduce((sum, factor) => sum + factor.points, 0) * 100) / 100;

  return {
    total,
    band: bandFor(total),
    factors,
    unavailableSignals: factors.filter((factor) => factor.unavailable).map((factor) => factor.kind),
  };
}

/**
 * The factors worth showing under "why am I seeing this?" — the ones that
 * actually contributed, strongest first.
 */
export function contributingFactors(score: AttentionScore): AttentionFactor[] {
  return score.factors.filter((factor) => factor.points > 0).sort((a, b) => b.points - a.points);
}
