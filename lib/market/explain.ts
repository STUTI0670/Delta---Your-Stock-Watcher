/**
 * "Why this was surfaced" — a plain-language account of the rules that fired.
 *
 * Composed from the same measurements the attention level is derived from, so
 * the explanation can never disagree with the decision it explains. Every
 * clause is a fact we actually measured; there is no generated prose here.
 *
 * Pure: no React, no database, no network.
 */

import { LARGE_PRICE_CHANGE_PCT, MEANINGFUL_PRICE_CHANGE_PCT } from '@/lib/market/config';

export interface ExplainInput {
  symbol: string;
  changePercent: number | null;
  severity: 'none' | 'notable' | 'large';
  volumeRatio?: number | null;
  volumeUnusual?: boolean;
  newsCount?: number;
  hasBaseline: boolean;
  priceAvailable: boolean;
}

export interface Explanation {
  /** The sentence shown under "Why this was surfaced". */
  headline: string;
  /** The individual measurements, each independently checkable. */
  points: string[];
}

function signed(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  if (rounded === 0) return '0.0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%`;
}

export function explainChange({
  symbol,
  changePercent,
  severity,
  volumeRatio,
  volumeUnusual = false,
  newsCount = 0,
  hasBaseline,
  priceAvailable,
}: ExplainInput): Explanation {
  const points: string[] = [];

  if (!priceAvailable) {
    return {
      headline: `We could not get a current price for ${symbol}, so there is nothing to compare against your last check.`,
      points: [],
    };
  }

  if (!hasBaseline) {
    return {
      headline: `${symbol} was added since your last check, so there is no earlier price to compare it against yet.`,
      points: ['This visit records the baseline we will measure against next time.'],
    };
  }

  if (changePercent !== null) {
    if (severity === 'large') {
      points.push(`Price moved ${signed(changePercent)}, past the ${LARGE_PRICE_CHANGE_PCT}% large-move threshold.`);
    } else if (severity === 'notable') {
      points.push(
        `Price moved ${signed(changePercent)}, past the ${MEANINGFUL_PRICE_CHANGE_PCT}% threshold for a meaningful change.`
      );
    } else {
      points.push(`Price moved ${signed(changePercent)}, below the ${MEANINGFUL_PRICE_CHANGE_PCT}% threshold.`);
    }
  }

  if (volumeUnusual && typeof volumeRatio === 'number') {
    points.push(`Trading volume is ${volumeRatio.toFixed(1)}× its recent daily average.`);
  } else if (typeof volumeRatio === 'number') {
    points.push(`Trading volume is ${volumeRatio.toFixed(1)}× its recent daily average, which is normal.`);
  }

  if (newsCount > 0) {
    points.push(`${newsCount} related ${newsCount === 1 ? 'story was' : 'stories were'} published since your last check.`);
  }

  // The headline names only the reasons that actually crossed a threshold.
  const triggers: string[] = [];
  if (severity !== 'none') triggers.push('moved significantly since your previous check');
  if (volumeUnusual) triggers.push('is trading well above its recent average volume');

  let headline: string;
  if (triggers.length === 0) {
    headline = `${symbol} did not cross any of the thresholds Delta watches, so it was not flagged for your attention.`;
  } else if (triggers.length === 1) {
    headline = `${symbol} ${triggers[0]}.`;
  } else {
    headline = `${symbol} ${triggers[0]} and ${triggers[1]}.`;
  }

  return { headline, points };
}
