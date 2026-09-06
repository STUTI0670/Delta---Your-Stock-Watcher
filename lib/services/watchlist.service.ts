/**
 * Watchlist service — the set of symbols a user has under watch.
 */

import {
  mongoWatchlistRepository,
  type StoredWatchItem,
  type WatchlistRepository,
} from '@/lib/services/repositories';

export type WatchItemSummary = StoredWatchItem;

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export async function listWatchlist(
  userId: string,
  repo: WatchlistRepository = mongoWatchlistRepository
): Promise<WatchItemSummary[]> {
  if (!userId) return [];
  return repo.list(userId);
}

export async function addWatchItem(
  userId: string,
  symbol: string,
  company: string,
  repo: WatchlistRepository = mongoWatchlistRepository
): Promise<WatchItemSummary> {
  const normalized = normalizeSymbol(symbol);
  if (!userId) throw new Error('A signed-in user is required.');
  if (!normalized) throw new Error('A symbol is required.');

  const item: StoredWatchItem = {
    userId,
    symbol: normalized,
    company: company?.trim() || normalized,
    addedAt: new Date(),
  };

  await repo.add(item);
  return item;
}

export async function removeWatchItem(
  userId: string,
  symbol: string,
  repo: WatchlistRepository = mongoWatchlistRepository
): Promise<boolean> {
  if (!userId) return false;
  return repo.remove(userId, normalizeSymbol(symbol));
}
