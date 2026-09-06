/**
 * Feedback-based personalization.
 *
 * When a user marks a surfaced change useful or not useful, Delta records
 * which *kind of signal* drove it. Over time those votes tilt how much each
 * signal contributes to that user's attention score.
 *
 * Three deliberate constraints stop this becoming a black box:
 *
 *   1. Weights are clamped. No amount of downvoting can silence a signal, and
 *      no amount of upvoting lets one drown out the others. A user who dislikes
 *      news still gets told when an earnings story lands.
 *   2. It only reweights, never rewrites. Feedback changes the ranking of real
 *      measurements; it can never invent a signal or suppress a measured fact.
 *   3. Old votes expire, so a preference from months ago does not quietly
 *      govern today's briefing.
 *
 * Pure: no React, no database, no network.
 */

import {
  FEEDBACK_LOOKBACK_DAYS,
  FEEDBACK_WEIGHT_MAX,
  FEEDBACK_WEIGHT_MIN,
  FEEDBACK_WEIGHT_STEP,
} from '@/lib/market/config';
import type { SignalKind, SignalWeights } from '@/lib/market/attention-score';

export type Vote = 'useful' | 'not-useful';

export interface FeedbackRecord {
  signalKind: SignalKind;
  vote: Vote;
  createdAt: Date | string;
}

export const SIGNAL_KINDS: SignalKind[] = ['price', 'volume', 'event', 'threshold'];

/** How each signal is named in the interface. */
export const SIGNAL_LABELS: Record<SignalKind, string> = {
  price: 'Price moves',
  volume: 'Unusual volume',
  event: 'Related news',
  threshold: 'Alert triggers',
};

function clamp(value: number): number {
  return Math.min(FEEDBACK_WEIGHT_MAX, Math.max(FEEDBACK_WEIGHT_MIN, value));
}

function isWithinLookback(createdAt: Date | string, now: Date): boolean {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;
  const ageDays = (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays <= FEEDBACK_LOOKBACK_DAYS;
}

/** Neutral weights — what every user starts with. */
export function neutralWeights(): Required<SignalWeights> {
  return { price: 1, volume: 1, event: 1, threshold: 1 };
}

/**
 * Fold a user's votes into per-signal weights.
 *
 * Each net vote moves a signal's weight by one step, then the result is
 * clamped. Votes outside the lookback window are ignored.
 */
export function deriveSignalWeights(
  records: FeedbackRecord[],
  now: Date = new Date()
): Required<SignalWeights> {
  const weights = neutralWeights();
  const net: Record<SignalKind, number> = { price: 0, volume: 0, event: 0, threshold: 0 };

  for (const record of records ?? []) {
    if (!SIGNAL_KINDS.includes(record.signalKind)) continue;
    if (!isWithinLookback(record.createdAt, now)) continue;
    net[record.signalKind] += record.vote === 'useful' ? 1 : -1;
  }

  for (const kind of SIGNAL_KINDS) {
    weights[kind] = clamp(1 + net[kind] * FEEDBACK_WEIGHT_STEP);
  }

  return weights;
}

/** Whether a set of weights differs from neutral, for "personalized" badging. */
export function isPersonalized(weights: SignalWeights): boolean {
  return SIGNAL_KINDS.some((kind) => {
    const weight = weights[kind];
    return typeof weight === 'number' && Math.abs(weight - 1) > 1e-9;
  });
}

/** Human-readable summary of how a user's briefing has been tuned. */
export function describeWeights(weights: SignalWeights): string[] {
  const descriptions: string[] = [];

  for (const kind of SIGNAL_KINDS) {
    const weight = weights[kind];
    if (typeof weight !== 'number' || Math.abs(weight - 1) <= 1e-9) continue;
    const direction = weight > 1 ? 'shown more prominently' : 'shown less prominently';
    descriptions.push(`${SIGNAL_LABELS[kind]} ${direction}.`);
  }

  return descriptions;
}
