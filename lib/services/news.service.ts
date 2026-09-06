/**
 * Company events counted per symbol since the user's last checkpoint.
 *
 * Yahoo supplies the stories; this only decides how many of them are new to the
 * user. When we cannot check at all the result is reported as *unavailable*
 * rather than zero, because "we did not look" and "we looked and found nothing"
 * mean very different things to someone reading an explanation.
 */

import { fetchSymbolNews } from '@/lib/market/providers/yahoo';

export interface NewsCounts {
  /** Article count per symbol, only for symbols we could actually check. */
  counts: Record<string, number>;
  /** True when no symbol could be checked. */
  unavailable: boolean;
}

export async function countNewsSince(symbols: string[], since: Date | null): Promise<NewsCounts> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
  if (unique.length === 0 || !since) return { counts: {}, unavailable: false };

  const sinceUnix = Math.floor(since.getTime() / 1000);

  const results = await Promise.all(
    unique.map(async (symbol) => {
      try {
        const articles = await fetchSymbolNews(symbol);
        return { symbol, count: articles.filter((a) => a.publishedAt >= sinceUnix).length };
      } catch (err) {
        console.error('countNewsSince failed for', symbol, err);
        return { symbol, count: null };
      }
    })
  );

  const counts: Record<string, number> = {};
  let checked = 0;
  for (const result of results) {
    if (result.count === null) continue;
    counts[result.symbol] = result.count;
    checked += 1;
  }

  return { counts, unavailable: checked === 0 };
}
