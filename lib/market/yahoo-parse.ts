/**
 * Pure parsing of Yahoo Finance chart payloads.
 *
 * Separated from the fetching module so the shape-handling — which is where the
 * subtle mistakes live — can be unit tested without a network call.
 *
 * Pure: no React, no database, no network.
 */

import { currencyFor, currencyForSymbol } from '@/lib/market/currency';
import { isStale } from '@/lib/market/freshness';

export interface DailyBar {
  date: Date;
  close: number;
  volume: number | null;
}

export interface MarketQuote {
  symbol: string;
  company: string | null;
  price: number | null;
  /** Change vs the previous close, in percent. */
  dayChangePercent: number | null;
  previousClose: number | null;
  /** ISO code the price is quoted in, e.g. "USD", "INR", "GBp". */
  currency: string | null;
  /** Provider timestamp for the quote, not the time we fetched it. */
  updatedAt: Date | null;
  source: string;
  stale: boolean;
  error: string | null;
}

export interface ChartMeta {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  currency?: string;
}

export interface ChartResult {
  meta?: ChartMeta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }> };
}

export interface ChartResponse {
  chart?: {
    result?: ChartResult[];
    error?: { description?: string } | null;
  };
}

export function failedQuote(symbol: string, error: string): MarketQuote {
  return {
    symbol,
    company: null,
    price: null,
    dayChangePercent: null,
    previousClose: null,
    currency: currencyForSymbol(symbol),
    updatedAt: null,
    source: 'yahoo',
    stale: true,
    error,
  };
}

/** Daily bars, oldest first. Sessions without a close are dropped, not zeroed. */
export function parseBars(result: ChartResult | undefined): DailyBar[] {
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!timestamps || !quote?.close) return [];

  const bars: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close[i];
    // Yahoo pads holidays and halted sessions with nulls; skip them rather than
    // letting a null become a fake zero-percent day.
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;

    const volume = quote.volume?.[i];
    bars.push({
      date: new Date(timestamps[i] * 1000),
      close,
      volume: typeof volume === 'number' && Number.isFinite(volume) ? volume : null,
    });
  }
  return bars;
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Is the newest bar the session the live price belongs to?
 *
 * Decided by date, not by comparing prices. Yahoo rounds `regularMarketPrice`
 * to cents but stores bar closes as float32, so the same session's figures
 * differ by ~1e-5 — an equality check on them silently picks the wrong bar.
 * The bar timestamp and the quote timestamp fall on the same UTC day for a
 * live session, which is unambiguous.
 */
function lastBarIsCurrentSession(lastBar: DailyBar, price: number, meta?: ChartMeta): boolean {
  if (typeof meta?.regularMarketTime === 'number' && meta.regularMarketTime > 0) {
    return isSameUtcDay(lastBar.date, new Date(meta.regularMarketTime * 1000));
  }
  // No quote timestamp: fall back to a tolerance wide enough for float32 noise
  // and cent-rounding, but far tighter than any real price move.
  return Math.abs(lastBar.close - price) <= Math.max(0.005, Math.abs(price) * 1e-4);
}

/**
 * The previous session's close, for the "today" figure.
 *
 * Deliberately derived from the bars rather than `meta.chartPreviousClose`:
 * on a multi-month range that field holds the close from *before the whole
 * range*, so using it reports a quarterly move as though it happened today.
 */
export function previousCloseFrom(bars: DailyBar[], price: number, meta?: ChartMeta): number | null {
  if (bars.length === 0) {
    return typeof meta?.previousClose === 'number' ? meta.previousClose : null;
  }

  const last = bars[bars.length - 1];
  if (!lastBarIsCurrentSession(last, price, meta)) return last.close;
  return bars.length >= 2 ? bars[bars.length - 2].close : null;
}

/** Build a quote from a chart payload's meta plus its bars. */
export function parseQuote(
  symbol: string,
  meta: ChartMeta | undefined,
  bars: DailyBar[],
  now: Date = new Date()
): MarketQuote {
  const price =
    typeof meta?.regularMarketPrice === 'number' && meta.regularMarketPrice > 0
      ? meta.regularMarketPrice
      : (bars[bars.length - 1]?.close ?? null);

  if (price === null) return failedQuote(symbol, 'No price returned for this symbol.');

  const previousClose = previousCloseFrom(bars, price, meta);
  const dayChangePercent =
    previousClose !== null && previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null;

  const updatedAt =
    typeof meta?.regularMarketTime === 'number' && meta.regularMarketTime > 0
      ? new Date(meta.regularMarketTime * 1000)
      : now;

  return {
    symbol,
    company: meta?.longName || meta?.shortName || null,
    price,
    dayChangePercent,
    previousClose,
    // The provider's own code where it gave one; the exchange suffix otherwise.
    currency: currencyFor(meta?.currency, symbol),
    updatedAt,
    source: 'yahoo',
    stale: isStale(updatedAt, now),
    error: null,
  };
}
