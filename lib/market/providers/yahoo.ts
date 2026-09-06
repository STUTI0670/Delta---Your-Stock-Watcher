'use server';

/**
 * Yahoo Finance — Delta's market data provider.
 *
 * One unauthenticated source for everything the product needs: live price,
 * daily history, volume, symbol search and company news. No API key, so the app
 * works out of the box.
 *
 * The chart endpoint is the workhorse. A single call returns both the live
 * quote (in `meta`) and the daily bars (in `indicators`), so one request per
 * symbol serves the price comparison, the volume baseline and the sparkline.
 *
 * Contract, uniform across every function here: never throw. A failure returns
 * a value carrying its own error, and where we have a previous good reading we
 * serve that instead — marked as such, never dressed up as live.
 */

import { VOLUME_BASELINE_SESSIONS } from '@/lib/market/config';
import { isStale } from '@/lib/market/freshness';
import {
  failedQuote,
  parseBars,
  parseQuote,
  type ChartResponse,
} from '@/lib/market/yahoo-parse';
import type { NewsArticle, SymbolData, SymbolSearchResult } from '@/lib/market/types';

const CHART_URL = process.env.YAHOO_CHART_URL ?? 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEARCH_URL = process.env.YAHOO_SEARCH_URL ?? 'https://query1.finance.yahoo.com/v1/finance/search';

/** Yahoo rejects requests without a browser-ish agent. */
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Delta/1.0)' } as const;

/* -------------------------------------------------------------------------- */
/*                                   caching                                   */
/* -------------------------------------------------------------------------- */

/**
 * Quotes are reused briefly to stay polite to a free endpoint. Deliberately our
 * own cache rather than Next's `revalidate`, which keeps serving a stale value
 * when the upstream starts failing and would present old prices as current.
 */
const QUOTE_TTL_MS = 60_000;

interface CacheEntry {
  data: SymbolData;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/* -------------------------------------------------------------------------- */
/*                                    chart                                    */
/* -------------------------------------------------------------------------- */

function degrade(symbol: string, reason: string): SymbolData {
  const cached = cache.get(symbol);
  if (!cached) {
    return { symbol, quote: failedQuote(symbol, reason), bars: [], historyError: reason };
  }
  // Keep the last real price and its original timestamp, but say it is not live.
  return {
    ...cached.data,
    quote: {
      ...cached.data.quote,
      stale: true,
      error: `${reason} Showing the last price we received.`,
    },
  };
}

/**
 * Live quote plus daily history for one symbol, in a single request.
 * Never throws.
 */
export async function fetchSymbolData(symbol: string): Promise<SymbolData> {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return { symbol: upper, quote: failedQuote(upper, 'No symbol given.'), bars: [], historyError: null };

  const cached = cache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < QUOTE_TTL_MS) {
    return {
      ...cached.data,
      quote: { ...cached.data.quote, stale: isStale(cached.data.quote.updatedAt) },
    };
  }

  // Ask for more calendar time than we need; weekends and holidays are not bars.
  const url = `${CHART_URL}/${encodeURIComponent(upper)}?range=3mo&interval=1d`;

  try {
    const res = await fetch(url, { cache: 'no-store', headers: HEADERS });
    if (!res.ok) return degrade(upper, `Market data provider responded ${res.status}.`);

    const payload = (await res.json()) as ChartResponse;
    const result = payload.chart?.result?.[0];
    if (!result) return degrade(upper, payload.chart?.error?.description ?? 'No data returned for this symbol.');

    const bars = parseBars(result).slice(-VOLUME_BASELINE_SESSIONS - 1);
    const quote = parseQuote(upper, result.meta, bars);
    if (quote.price === null) return degrade(upper, 'No price returned for this symbol.');

    const data: SymbolData = {
      symbol: upper,
      quote,
      bars,
      historyError: bars.length === 0 ? 'No price history returned for this symbol.' : null,
    };

    cache.set(upper, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error('fetchSymbolData failed for', upper, err);
    return degrade(upper, 'Could not reach the market data provider.');
  }
}

/** Many symbols at once, keyed by symbol. Partial failure is normal. */
export async function fetchSymbols(symbols: string[]): Promise<Record<string, SymbolData>> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  const results = await Promise.all(unique.map(fetchSymbolData));

  return results.reduce<Record<string, SymbolData>>((acc, data) => {
    acc[data.symbol] = data;
    return acc;
  }, {});
}

/* -------------------------------------------------------------------------- */
/*                               search and news                               */
/* -------------------------------------------------------------------------- */

interface SearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
}

interface SearchNews {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
}

interface SearchResponse {
  quotes?: SearchQuote[];
  news?: SearchNews[];
}

async function search(query: string, quotesCount: number, newsCount: number): Promise<SearchResponse> {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&quotesCount=${quotesCount}&newsCount=${newsCount}`;
  const res = await fetch(url, { cache: 'no-store', headers: HEADERS });
  if (!res.ok) throw new Error(`Search responded ${res.status}`);
  return (await res.json()) as SearchResponse;
}

/** Symbol lookup. Equities only, de-duplicated. Never throws. */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const data = await search(trimmed, 10, 0);
    const seen = new Set<string>();
    const results: SymbolSearchResult[] = [];

    for (const quote of data.quotes ?? []) {
      const symbol = quote.symbol?.toUpperCase();
      if (!symbol || quote.quoteType !== 'EQUITY' || seen.has(symbol)) continue;
      seen.add(symbol);
      results.push({
        symbol,
        name: quote.longname || quote.shortname || symbol,
        exchange: quote.exchange || 'US',
      });
    }

    return results.slice(0, 12);
  } catch (err) {
    console.error('searchSymbols failed for', trimmed, err);
    return [];
  }
}

/**
 * Recent news for a symbol, newest first.
 *
 * Yahoo returns stories matching the ticker as a search term. They are
 * topically related rather than guaranteed filings for that company, which is
 * why the product calls them "relevant events" rather than company filings.
 */
export async function fetchSymbolNews(symbol: string, limit = 8): Promise<NewsArticle[]> {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return [];

  try {
    const data = await search(upper, 1, limit);
    const articles: NewsArticle[] = [];
    const seen = new Set<string>();

    for (const item of data.news ?? []) {
      if (!item.title || !item.link || typeof item.providerPublishTime !== 'number') continue;
      // Syndicated stories repeat across outlets; count the story, not the copies.
      const key = item.title.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      articles.push({
        id: item.uuid ?? `${key}-${item.providerPublishTime}`,
        headline: item.title.trim(),
        source: item.publisher ?? 'Yahoo Finance',
        url: item.link,
        publishedAt: item.providerPublishTime,
      });
    }

    return articles.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
  } catch (err) {
    console.error('fetchSymbolNews failed for', upper, err);
    return [];
  }
}
