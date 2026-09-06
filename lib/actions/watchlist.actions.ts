'use server';

import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { WatchItem } from '@/database/models/watch-item.model';
import { getSessionUser } from '@/lib/actions/session';
import { addWatchItem, listWatchlist, removeWatchItem } from '@/lib/services/watchlist.service';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function addToWatchlist(symbol: string, company: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in to watch a stock.' };

  try {
    await addWatchItem(user.id, symbol, company);
    revalidatePath('/');
    revalidatePath(`/stocks/${symbol.toUpperCase()}`);
    return { ok: true };
  } catch (err) {
    console.error('addToWatchlist failed', err);
    return { ok: false, error: 'Could not add this stock to your watchlist.' };
  }
}

export async function removeFromWatchlist(symbol: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  try {
    await removeWatchItem(user.id, symbol);
    revalidatePath('/');
    revalidatePath(`/stocks/${symbol.toUpperCase()}`);
    return { ok: true };
  } catch (err) {
    console.error('removeFromWatchlist failed', err);
    return { ok: false, error: 'Could not remove this stock from your watchlist.' };
  }
}

/** Symbols the signed-in user is watching. */
export async function getWatchedSymbols(): Promise<string[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const items = await listWatchlist(user.id);
  return items.map((item) => item.symbol);
}

export async function isWatched(symbol: string): Promise<boolean> {
  const symbols = await getWatchedSymbols();
  return symbols.includes(symbol.trim().toUpperCase());
}

/**
 * Watched symbols for a user identified by email. Used by background jobs,
 * which run outside a request and therefore have no session.
 */
export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> {
  if (!email) return [];

  try {
    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection not found');

    // Better Auth stores users in the "user" collection.
    const user = await db.collection('user').findOne<{ _id?: unknown; id?: string }>({ email });
    if (!user) return [];

    const userId = (user.id as string) || String(user._id || '');
    if (!userId) return [];

    const items = await WatchItem.find({ userId }, { symbol: 1 }).lean();
    return items.map((item) => String(item.symbol));
  } catch (err) {
    console.error('getWatchlistSymbolsByEmail error:', err);
    return [];
  }
}
