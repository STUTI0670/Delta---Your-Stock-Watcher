import type { DailyBar, MarketQuote } from '@/lib/market/yahoo-parse';

export interface SymbolData {
  symbol: string;
  quote: MarketQuote;
  bars: DailyBar[];
  historyError: string | null;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export interface NewsArticle {
  id: string;
  headline: string;
  source: string;
  url: string;
  /** Unix seconds. */
  publishedAt: number;
}
