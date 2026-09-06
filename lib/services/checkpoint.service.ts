/**
 * Checkpoint service — Delta's core mechanism.
 *
 * A checkpoint is the market state as it stood the last time the user actually
 * reviewed their watchlist. The ordering here is the important part:
 *
 *   1. read the previous checkpoint
 *   2. compute the changes against it
 *   3. only then advance the checkpoint
 *
 * Advancing first would compare the present against itself and permanently
 * destroy the answer to "what changed while I was away".
 */

import { MIN_CHECKPOINT_INTERVAL_MS } from '@/lib/market/config';
import type { CheckpointPriceSnapshot } from '@/database/models/checkpoint.model';
import {
  mongoCheckpointRepository,
  type CheckpointRepository,
  type StoredCheckpoint,
} from '@/lib/services/repositories';

export interface QuoteForSnapshot {
  symbol: string;
  price: number | null;
  updatedAt?: Date | null;
}

/** Read the checkpoint a comparison should be measured against. */
export async function getCheckpoint(
  userId: string,
  repo: CheckpointRepository = mongoCheckpointRepository
): Promise<StoredCheckpoint | null> {
  if (!userId) return null;
  return repo.find(userId);
}

/** Index a checkpoint's snapshots by symbol for O(1) lookup during comparison. */
export function indexSnapshots(checkpoint: StoredCheckpoint | null): Record<string, CheckpointPriceSnapshot> {
  if (!checkpoint) return {};
  return checkpoint.snapshots.reduce<Record<string, CheckpointPriceSnapshot>>((acc, snapshot) => {
    acc[snapshot.symbol.toUpperCase()] = snapshot;
    return acc;
  }, {});
}

/**
 * Whether enough time has passed to move the checkpoint forward.
 *
 * Without this, refreshing the dashboard would instantly overwrite the baseline
 * and the "since you last checked" panel would collapse to zero on the second
 * page view. A user gets a stable comparison window instead.
 */
export function shouldAdvanceCheckpoint(previous: StoredCheckpoint | null, now: Date = new Date()): boolean {
  if (!previous) return true;
  return now.getTime() - new Date(previous.checkedAt).getTime() >= MIN_CHECKPOINT_INTERVAL_MS;
}

/** Build the snapshot list to persist, keeping only symbols with a real price. */
export function buildSnapshots(quotes: QuoteForSnapshot[], now: Date = new Date()): CheckpointPriceSnapshot[] {
  return quotes
    .filter((quote): quote is QuoteForSnapshot & { price: number } => typeof quote.price === 'number' && Number.isFinite(quote.price))
    .map((quote) => ({
      symbol: quote.symbol.toUpperCase(),
      price: quote.price,
      capturedAt: quote.updatedAt ?? now,
    }));
}

/**
 * Advance the checkpoint after a comparison has been prepared.
 *
 * Symbols whose price could not be fetched keep their previous snapshot rather
 * than being dropped, so a transient provider outage does not silently erase a
 * user's baseline for those symbols.
 */
export async function commitCheckpoint(
  userId: string,
  quotes: QuoteForSnapshot[],
  previous: StoredCheckpoint | null,
  now: Date = new Date(),
  repo: CheckpointRepository = mongoCheckpointRepository
): Promise<StoredCheckpoint> {
  const fresh = buildSnapshots(quotes, now);
  const freshSymbols = new Set(fresh.map((snapshot) => snapshot.symbol));
  const requested = new Set(quotes.map((quote) => quote.symbol.toUpperCase()));

  const carriedOver = (previous?.snapshots ?? []).filter(
    (snapshot) => requested.has(snapshot.symbol.toUpperCase()) && !freshSymbols.has(snapshot.symbol.toUpperCase())
  );

  const checkpoint: StoredCheckpoint = {
    userId,
    checkedAt: now,
    snapshots: [...fresh, ...carriedOver],
  };

  await repo.save(checkpoint);
  return checkpoint;
}
