import { describe, expect, it } from 'vitest';
import {
  buildSnapshots,
  commitCheckpoint,
  getCheckpoint,
  indexSnapshots,
  shouldAdvanceCheckpoint,
} from '@/lib/services/checkpoint.service';
import { detectWatchlistChanges } from '@/lib/market/change-detection';
import { MIN_CHECKPOINT_INTERVAL_MS } from '@/lib/market/config';
import { createFakeCheckpointRepo, createFakeWatchlistRepo } from './fakes';
import { addWatchItem, listWatchlist, removeWatchItem } from '@/lib/services/watchlist.service';

describe('checkpoint persistence', () => {
  it('stores a checkpoint that can be read back for the same user', async () => {
    const repo = createFakeCheckpointRepo();
    const now = new Date('2026-09-06T10:00:00Z');

    await commitCheckpoint('user-1', [{ symbol: 'NVDA', price: 170, updatedAt: now }], null, now, repo);

    const reloaded = await getCheckpoint('user-1', repo);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.checkedAt).toEqual(now);
    expect(reloaded!.snapshots).toEqual([{ symbol: 'NVDA', price: 170, capturedAt: now }]);
  });

  it('scopes checkpoints per user', async () => {
    const repo = createFakeCheckpointRepo();
    const now = new Date();

    await commitCheckpoint('user-1', [{ symbol: 'NVDA', price: 170 }], null, now, repo);
    await commitCheckpoint('user-2', [{ symbol: 'TSLA', price: 350 }], null, now, repo);

    expect((await getCheckpoint('user-1', repo))!.snapshots[0].symbol).toBe('NVDA');
    expect((await getCheckpoint('user-2', repo))!.snapshots[0].symbol).toBe('TSLA');
  });

  it('overwrites the same user checkpoint rather than accumulating rows', async () => {
    const repo = createFakeCheckpointRepo();
    const first = new Date('2026-09-05T10:00:00Z');
    const second = new Date('2026-09-06T10:00:00Z');

    await commitCheckpoint('user-1', [{ symbol: 'NVDA', price: 100 }], null, first, repo);
    const previous = await getCheckpoint('user-1', repo);
    await commitCheckpoint('user-1', [{ symbol: 'NVDA', price: 120 }], previous, second, repo);

    expect(repo.store.size).toBe(1);
    const latest = await getCheckpoint('user-1', repo);
    expect(latest!.checkedAt).toEqual(second);
    expect(latest!.snapshots).toEqual([{ symbol: 'NVDA', price: 120, capturedAt: second }]);
  });

  it('returns null for a user who has never checked', async () => {
    expect(await getCheckpoint('nobody', createFakeCheckpointRepo())).toBeNull();
  });

  it('drops symbols with no usable price from the snapshot', () => {
    const now = new Date();
    const snapshots = buildSnapshots(
      [
        { symbol: 'NVDA', price: 170 },
        { symbol: 'AAPL', price: null },
        { symbol: 'TSLA', price: Number.NaN },
      ],
      now
    );

    expect(snapshots.map((s) => s.symbol)).toEqual(['NVDA']);
  });

  it('carries over a previous snapshot when the price could not be refetched', async () => {
    const repo = createFakeCheckpointRepo();
    const earlier = new Date('2026-09-05T10:00:00Z');
    const now = new Date('2026-09-06T10:00:00Z');

    await commitCheckpoint(
      'user-1',
      [
        { symbol: 'NVDA', price: 100, updatedAt: earlier },
        { symbol: 'AAPL', price: 200, updatedAt: earlier },
      ],
      null,
      earlier,
      repo
    );
    const previous = await getCheckpoint('user-1', repo);

    // AAPL fails this round; its baseline must survive rather than be erased.
    await commitCheckpoint(
      'user-1',
      [
        { symbol: 'NVDA', price: 110, updatedAt: now },
        { symbol: 'AAPL', price: null },
      ],
      previous,
      now,
      repo
    );

    const latest = await getCheckpoint('user-1', repo);
    const bySymbol = indexSnapshots(latest);
    expect(bySymbol.NVDA.price).toBe(110);
    expect(bySymbol.AAPL.price).toBe(200);
  });

  it('does not carry over snapshots for symbols removed from the watchlist', async () => {
    const repo = createFakeCheckpointRepo({
      userId: 'user-1',
      checkedAt: new Date('2026-09-05T10:00:00Z'),
      snapshots: [
        { symbol: 'NVDA', price: 100, capturedAt: new Date('2026-09-05T10:00:00Z') },
        { symbol: 'OLD', price: 50, capturedAt: new Date('2026-09-05T10:00:00Z') },
      ],
    });
    const previous = await getCheckpoint('user-1', repo);

    await commitCheckpoint('user-1', [{ symbol: 'NVDA', price: 110 }], previous, new Date(), repo);

    const latest = await getCheckpoint('user-1', repo);
    expect(latest!.snapshots.map((s) => s.symbol)).toEqual(['NVDA']);
  });
});

describe('checkpoint advancement policy', () => {
  it('advances on a first ever visit', () => {
    expect(shouldAdvanceCheckpoint(null)).toBe(true);
  });

  it('does not advance on a quick refresh, so the comparison stays readable', () => {
    const now = new Date('2026-09-06T10:00:00Z');
    const justChecked = { userId: 'u', checkedAt: new Date(now.getTime() - 60_000), snapshots: [] };
    expect(shouldAdvanceCheckpoint(justChecked, now)).toBe(false);
  });

  it('advances once the comparison window has elapsed', () => {
    const now = new Date('2026-09-06T10:00:00Z');
    const stale = {
      userId: 'u',
      checkedAt: new Date(now.getTime() - MIN_CHECKPOINT_INTERVAL_MS - 1000),
      snapshots: [],
    };
    expect(shouldAdvanceCheckpoint(stale, now)).toBe(true);
  });
});

describe('comparison against the previous checkpoint', () => {
  it('produces the "since you last checked" answer end to end', async () => {
    const repo = createFakeCheckpointRepo();
    const yesterday = new Date('2026-09-05T18:20:00Z');
    const today = new Date('2026-09-06T09:00:00Z');

    // Yesterday's visit establishes the baseline.
    await commitCheckpoint(
      'user-1',
      [
        { symbol: 'NVDA', price: 100, updatedAt: yesterday },
        { symbol: 'TSLA', price: 100, updatedAt: yesterday },
        { symbol: 'AAPL', price: 100, updatedAt: yesterday },
      ],
      null,
      yesterday,
      repo
    );

    // Today's visit reads the baseline BEFORE advancing it.
    const previous = await getCheckpoint('user-1', repo);
    const snapshots = indexSnapshots(previous);

    const { needsAttention, changes } = detectWatchlistChanges([
      {
        symbol: 'NVDA',
        company: 'NVIDIA Corp',
        snapshot: snapshots.NVDA,
        quote: { symbol: 'NVDA', price: 107.4, updatedAt: today, stale: false, error: null },
      },
      {
        symbol: 'TSLA',
        company: 'Tesla Inc',
        snapshot: snapshots.TSLA,
        quote: { symbol: 'TSLA', price: 95.8, updatedAt: today, stale: false, error: null },
      },
      {
        symbol: 'AAPL',
        company: 'Apple Inc',
        snapshot: snapshots.AAPL,
        quote: { symbol: 'AAPL', price: 100.3, updatedAt: today, stale: false, error: null },
      },
    ]);

    expect(needsAttention.map((c) => c.symbol)).toEqual(['NVDA', 'TSLA']);
    expect(changes.find((c) => c.symbol === 'AAPL')!.summary).toBe('No significant change.');

    // Only now is the checkpoint advanced.
    await commitCheckpoint(
      'user-1',
      [
        { symbol: 'NVDA', price: 107.4, updatedAt: today },
        { symbol: 'TSLA', price: 95.8, updatedAt: today },
        { symbol: 'AAPL', price: 100.3, updatedAt: today },
      ],
      previous,
      today,
      repo
    );

    const advanced = await getCheckpoint('user-1', repo);
    expect(advanced!.checkedAt).toEqual(today);
    expect(indexSnapshots(advanced).NVDA.price).toBe(107.4);
  });

  it('reports no change when compared against a checkpoint taken at the same prices', async () => {
    const repo = createFakeCheckpointRepo();
    const t0 = new Date('2026-09-06T09:00:00Z');
    await commitCheckpoint('user-1', [{ symbol: 'NVDA', price: 107.4 }], null, t0, repo);

    const previous = await getCheckpoint('user-1', repo);
    const { needsAttention } = detectWatchlistChanges([
      {
        symbol: 'NVDA',
        company: 'NVIDIA Corp',
        snapshot: indexSnapshots(previous).NVDA,
        quote: { symbol: 'NVDA', price: 107.4, updatedAt: new Date(), stale: false, error: null },
      },
    ]);

    expect(needsAttention).toHaveLength(0);
  });
});

describe('watchlist persistence', () => {
  it('adds, lists and removes symbols for a user', async () => {
    const repo = createFakeWatchlistRepo();

    await addWatchItem('user-1', 'nvda', 'NVIDIA Corp', repo);
    await addWatchItem('user-1', 'AAPL', 'Apple Inc', repo);

    const items = await listWatchlist('user-1', repo);
    expect(items.map((i) => i.symbol).sort()).toEqual(['AAPL', 'NVDA']);

    expect(await removeWatchItem('user-1', 'nvda', repo)).toBe(true);
    expect((await listWatchlist('user-1', repo)).map((i) => i.symbol)).toEqual(['AAPL']);
  });

  it('does not duplicate a symbol already watched', async () => {
    const repo = createFakeWatchlistRepo();
    await addWatchItem('user-1', 'NVDA', 'NVIDIA Corp', repo);
    await addWatchItem('user-1', 'NVDA', 'NVIDIA Corp', repo);

    expect(await listWatchlist('user-1', repo)).toHaveLength(1);
  });

  it('keeps each user watchlist separate', async () => {
    const repo = createFakeWatchlistRepo();
    await addWatchItem('user-1', 'NVDA', 'NVIDIA Corp', repo);
    await addWatchItem('user-2', 'TSLA', 'Tesla Inc', repo);

    expect((await listWatchlist('user-1', repo)).map((i) => i.symbol)).toEqual(['NVDA']);
    expect((await listWatchlist('user-2', repo)).map((i) => i.symbol)).toEqual(['TSLA']);
  });

  it('rejects an empty symbol', async () => {
    await expect(addWatchItem('user-1', '   ', 'Nothing', createFakeWatchlistRepo())).rejects.toThrow('symbol');
  });
});
