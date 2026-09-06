/**
 * The baseline belongs to the user's own visits.
 *
 * The daily briefing job reads the same attention report the dashboard does.
 * If that read advanced the checkpoint, the job would consume the very
 * comparison it was reporting on — the email would say "NVDA +7.6% since you
 * last checked" and the app, opened a minute later, would say nothing had
 * changed. These tests pin that down.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredCheckpoint } from '@/lib/services/repositories';

const getCheckpoint = vi.fn<() => Promise<StoredCheckpoint | null>>();
const commitCheckpoint = vi.fn();

vi.mock('@/lib/services/checkpoint.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/checkpoint.service')>();
  return { ...actual, getCheckpoint: () => getCheckpoint(), commitCheckpoint: (...args: unknown[]) => commitCheckpoint(...args) };
});

vi.mock('@/lib/services/watchlist.service', () => ({
  listWatchlist: async () => [{ userId: 'user-1', symbol: 'NVDA', company: 'NVIDIA Corp', addedAt: new Date() }],
}));

vi.mock('@/lib/market/providers/yahoo', () => ({
  fetchSymbols: async () => ({
    NVDA: {
      symbol: 'NVDA',
      quote: {
        symbol: 'NVDA',
        company: 'NVIDIA Corp',
        price: 107.6,
        dayChangePercent: 7.6,
        previousClose: 100,
        currency: 'USD',
        updatedAt: new Date('2026-09-06T15:00:00Z'),
        source: 'yahoo',
        stale: false,
        error: null,
      },
      bars: [],
      historyError: null,
    },
  }),
}));

vi.mock('@/lib/services/news.service', () => ({
  countNewsSince: async () => ({ counts: { NVDA: 0 }, unavailable: false }),
}));

vi.mock('@/lib/services/insight.service', () => ({
  buildSymbolInsights: () => [],
  countThresholdCrossings: async () => ({}),
}));

vi.mock('@/lib/services/feedback.service', () => ({
  getSignalWeights: async () => ({ price: 1, volume: 1, event: 1, threshold: 1 }),
}));

vi.mock('@/lib/services/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/repositories')>();
  return { ...actual, mongoAlertEventRepository: { ...actual.mongoAlertEventRepository, listByUserSince: async () => [] } };
});

const { buildAttentionReport } = await import('@/lib/services/attention.service');

/** Old enough that the minimum checkpoint interval has comfortably elapsed. */
const STALE_CHECKPOINT: StoredCheckpoint = {
  userId: 'user-1',
  checkedAt: new Date('2026-09-05T09:12:00Z'),
  snapshots: [{ symbol: 'NVDA', price: 100, capturedAt: new Date('2026-09-05T09:12:00Z') }],
};

const NOW = new Date('2026-09-06T18:45:00Z');

beforeEach(() => {
  getCheckpoint.mockReset().mockResolvedValue(STALE_CHECKPOINT);
  commitCheckpoint.mockReset().mockResolvedValue(undefined);
});

describe('buildAttentionReport — who is allowed to move the baseline', () => {
  it('advances the checkpoint by default, because a visit is a check', async () => {
    await buildAttentionReport('user-1', NOW);
    expect(commitCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('leaves the checkpoint alone for a background job', async () => {
    await buildAttentionReport('user-1', NOW, { advanceCheckpoint: false });
    expect(commitCheckpoint).not.toHaveBeenCalled();
  });

  it('still reports the full comparison when it does not advance', async () => {
    const report = await buildAttentionReport('user-1', NOW, { advanceCheckpoint: false });

    expect(report.comparedTo).toEqual(STALE_CHECKPOINT.checkedAt);
    expect(report.needsAttention).toHaveLength(1);
    expect(report.needsAttention[0].symbol).toBe('NVDA');
    expect(report.needsAttention[0].changePercent).toBeCloseTo(7.6, 5);
  });

  it('gives a job and a visit the same answer for the same moment', async () => {
    const forTheJob = await buildAttentionReport('user-1', NOW, { advanceCheckpoint: false });
    const forTheUser = await buildAttentionReport('user-1', NOW);

    expect(forTheJob.needsAttention.map((change) => change.symbol)).toEqual(
      forTheUser.needsAttention.map((change) => change.symbol)
    );
    expect(forTheJob.comparedTo).toEqual(forTheUser.comparedTo);
  });
});
