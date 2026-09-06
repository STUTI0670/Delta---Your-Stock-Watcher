'use server';

import { fetchSymbolNews, searchSymbols } from '@/lib/market/providers/yahoo';
import type { NewsArticle, SymbolSearchResult } from '@/lib/market/types';

/** Symbol lookup for the ⌘K palette. */
export async function searchStocks(query: string): Promise<SymbolSearchResult[]> {
  return searchSymbols(query);
}

/** Recent stories for one symbol, shown as "relevant events". */
export async function getSymbolNews(symbol: string, limit = 5): Promise<NewsArticle[]> {
  return fetchSymbolNews(symbol, limit);
}

/**
 * A round-robin mix of recent stories across several symbols, newest first.
 * Used by the daily email job, which summarises a whole watchlist.
 */
export async function getWatchlistNews(symbols: string[], max = 6): Promise<NewsArticle[]> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  if (unique.length === 0) return [];

  const perSymbol = await Promise.all(unique.map((symbol) => fetchSymbolNews(symbol, 3).catch(() => [])));

  // Take one story per symbol per pass so no single ticker dominates the digest.
  const collected: NewsArticle[] = [];
  const seen = new Set<string>();
  for (let round = 0; collected.length < max && round < 3; round++) {
    for (const articles of perSymbol) {
      const article = articles[round];
      if (!article || seen.has(article.id)) continue;
      seen.add(article.id);
      collected.push(article);
      if (collected.length >= max) break;
    }
  }

  return collected.sort((a, b) => b.publishedAt - a.publishedAt);
}
