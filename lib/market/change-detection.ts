/**
 * Pure, deterministic "what changed since I last checked?" logic.
 *
 * No React, no database, no network — everything here is a function of its
 * arguments so it can be unit tested directly.
 */

import { currencyFor } from '@/lib/market/currency';
import {
  LARGE_PRICE_CHANGE_PCT,
  MEANINGFUL_PRICE_CHANGE_PCT,
  MEANINGFUL_VOLUME_SPIKE_RATIO,
} from '@/lib/market/config';

export type Severity = 'none' | 'notable' | 'large';

export interface CheckpointSnapshot {
  symbol: string;
  price: number;
  volume?: number;
  capturedAt: Date | string;
}

export interface CurrentQuote {
  symbol: string;
  price: number | null;
  volume?: number | null;
  /** Intraday % change from the provider, used only as a display value. */
  dayChangePercent?: number | null;
  /** ISO code the price is quoted in. Falls back to the ticker's exchange. */
  currency?: string | null;
  updatedAt?: Date | string | null;
  stale?: boolean;
  error?: string | null;
}

export interface ChangeReason {
  kind: 'price' | 'volume' | 'news';
  text: string;
}

export interface SymbolChange {
  symbol: string;
  company: string;
  /** Price at the user's previous checkpoint, if we had one. */
  previousPrice: number | null;
  currentPrice: number | null;
  /** The currency every price on this change is quoted in. */
  currency: string;
  /** % move measured against the checkpoint, not against today's open. */
  changePercent: number | null;
  dayChangePercent: number | null;
  severity: Severity;
  isMeaningful: boolean;
  reasons: ChangeReason[];
  /** Human-readable one-liner shown under the symbol. */
  summary: string;
  hasBaseline: boolean;
  stale: boolean;
  updatedAt: Date | null;
  error: string | null;
  newsCount: number;
}

/** Percentage move from `previous` to `current`. Returns null if incomputable. */
export function percentChange(previous: number | null | undefined, current: number | null | undefined): number | null {
  if (typeof previous !== 'number' || typeof current !== 'number') return null;
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Classify a percentage move into a severity band. */
export function classifyPriceChange(changePercent: number | null): Severity {
  if (changePercent === null || !Number.isFinite(changePercent)) return 'none';
  const magnitude = Math.abs(changePercent);
  if (magnitude >= LARGE_PRICE_CHANGE_PCT) return 'large';
  if (magnitude >= MEANINGFUL_PRICE_CHANGE_PCT) return 'notable';
  return 'none';
}

/** The single rule that defines a meaningful price move. */
export function isMeaningfulPriceChange(changePercent: number | null): boolean {
  return classifyPriceChange(changePercent) !== 'none';
}

/** A volume spike needs both a baseline and a current reading to be trusted. */
export function isVolumeSpike(previousVolume?: number | null, currentVolume?: number | null): boolean {
  if (typeof previousVolume !== 'number' || typeof currentVolume !== 'number') return false;
  if (!Number.isFinite(previousVolume) || !Number.isFinite(currentVolume)) return false;
  if (previousVolume <= 0) return false;
  return currentVolume / previousVolume >= MEANINGFUL_VOLUME_SPIKE_RATIO;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface DetectChangeInput {
  symbol: string;
  company: string;
  quote: CurrentQuote;
  snapshot?: CheckpointSnapshot | null;
  /** Count of news items published for this symbol since the checkpoint. */
  newsCount?: number;
}

/**
 * Compare one symbol's current quote against the user's previous checkpoint.
 */
export function detectSymbolChange({
  symbol,
  company,
  quote,
  snapshot,
  newsCount = 0,
}: DetectChangeInput): SymbolChange {
  const previousPrice = typeof snapshot?.price === 'number' ? snapshot.price : null;
  const currentPrice = typeof quote.price === 'number' ? quote.price : null;
  const hasBaseline = previousPrice !== null && currentPrice !== null;

  const changePercent = percentChange(previousPrice, currentPrice);
  const severity = classifyPriceChange(changePercent);
  const reasons: ChangeReason[] = [];

  if (severity !== 'none' && changePercent !== null) {
    reasons.push({
      kind: 'price',
      text: `Price moved ${formatPercent(changePercent)} since your last visit.`,
    });
  }

  if (isVolumeSpike(snapshot?.volume, quote.volume)) {
    const ratio = (quote.volume as number) / (snapshot!.volume as number);
    reasons.push({
      kind: 'volume',
      text: `Volume is ${ratio.toFixed(1)}× its level at your last check.`,
    });
  }

  // News only reinforces an existing price signal in P1; it never promotes a
  // flat stock into "Needs Attention" on its own.
  if (severity !== 'none' && newsCount > 0) {
    reasons.push({
      kind: 'news',
      text: `${newsCount} news ${newsCount === 1 ? 'item' : 'items'} published since your last visit.`,
    });
  }

  const isMeaningful = severity !== 'none';

  let summary: string;
  if (currentPrice === null) {
    summary = 'Price data unavailable right now.';
  } else if (!hasBaseline) {
    summary = 'First time tracked — no previous check to compare against.';
  } else if (severity === 'large') {
    summary = 'Large movement since your last visit.';
  } else if (severity === 'notable') {
    summary = 'Significant movement since your last visit.';
  } else {
    summary = 'No significant change.';
  }

  return {
    symbol,
    company,
    previousPrice,
    currentPrice,
    currency: currencyFor(quote.currency, symbol),
    changePercent,
    dayChangePercent: typeof quote.dayChangePercent === 'number' ? quote.dayChangePercent : null,
    severity,
    isMeaningful,
    reasons,
    summary,
    hasBaseline,
    stale: Boolean(quote.stale),
    updatedAt: toDate(quote.updatedAt),
    error: quote.error ?? null,
    newsCount,
  };
}

/**
 * Run detection across a watchlist and split it into what needs attention and
 * everything else. Attention items are ordered by magnitude of the move.
 */
export function detectWatchlistChanges(inputs: DetectChangeInput[]): {
  changes: SymbolChange[];
  needsAttention: SymbolChange[];
} {
  const changes = inputs.map(detectSymbolChange);
  const needsAttention = changes
    .filter((change) => change.isMeaningful)
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0));

  return { changes, needsAttention };
}
