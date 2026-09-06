import { describe, expect, it } from 'vitest';
import {
  clearFeedback,
  getFeedbackIndex,
  getSignalWeights,
  listFeedback,
  recordFeedback,
} from '@/lib/services/feedback.service';
import { neutralWeights } from '@/lib/market/personalization';
import { createFakeFeedbackRepo } from './fakes';

const now = new Date('2026-09-06T12:00:00Z');

describe('recordFeedback', () => {
  it('normalises the symbol', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', ' nvda ', 'price', 'useful', repo, now);

    expect(repo.all()[0].symbol).toBe('NVDA');
  });

  it('replaces a previous opinion rather than stacking votes', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', 'NVDA', 'price', 'useful', repo, now);
    await recordFeedback('user-1', 'NVDA', 'price', 'not-useful', repo, now);

    const stored = repo.all();
    expect(stored).toHaveLength(1);
    expect(stored[0].vote).toBe('not-useful');
    // A changed mind must not leave the user net-neutral by accident.
    expect((await getSignalWeights('user-1', repo, now)).price).toBeLessThan(1);
  });

  it('keeps votes on different signals and symbols apart', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', 'NVDA', 'price', 'useful', repo, now);
    await recordFeedback('user-1', 'NVDA', 'volume', 'useful', repo, now);
    await recordFeedback('user-1', 'TSLA', 'price', 'useful', repo, now);

    expect(repo.all()).toHaveLength(3);
  });

  it('rejects a missing user or symbol', async () => {
    const repo = createFakeFeedbackRepo();
    await expect(recordFeedback('', 'NVDA', 'price', 'useful', repo, now)).rejects.toThrow('signed-in');
    await expect(recordFeedback('user-1', '   ', 'price', 'useful', repo, now)).rejects.toThrow('symbol');
  });
});

describe('clearFeedback', () => {
  it('removes a vote so the thumb toggles off', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', 'NVDA', 'price', 'useful', repo, now);

    expect(await clearFeedback('user-1', 'nvda', 'price', repo)).toBe(true);
    expect(await listFeedback('user-1', repo)).toHaveLength(0);
    expect(await getSignalWeights('user-1', repo, now)).toEqual(neutralWeights());
  });

  it('reports nothing removed when there was no vote', async () => {
    expect(await clearFeedback('user-1', 'NVDA', 'price', createFakeFeedbackRepo())).toBe(false);
  });
});

describe('getSignalWeights', () => {
  it('is neutral for a user with no feedback', async () => {
    expect(await getSignalWeights('user-1', createFakeFeedbackRepo(), now)).toEqual(neutralWeights());
  });

  it('aggregates votes across symbols for the same signal', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', 'NVDA', 'event', 'not-useful', repo, now);
    await recordFeedback('user-1', 'TSLA', 'event', 'not-useful', repo, now);

    const weights = await getSignalWeights('user-1', repo, now);
    expect(weights.event).toBeLessThan(1);
    expect(weights.price).toBe(1);
  });

  it('never leaks one user preferences into another', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', 'NVDA', 'price', 'useful', repo, now);

    expect(await getSignalWeights('user-2', repo, now)).toEqual(neutralWeights());
  });

  it('degrades to neutral weights when the store is unavailable', async () => {
    const broken = {
      listByUser: async () => {
        throw new Error('db down');
      },
      record: async () => {},
      clear: async () => false,
    };
    // A feedback outage must not break the briefing.
    expect(await getSignalWeights('user-1', broken, now)).toEqual(neutralWeights());
  });
});

describe('getFeedbackIndex', () => {
  it('keys votes for quick lookup by symbol and signal', async () => {
    const repo = createFakeFeedbackRepo();
    await recordFeedback('user-1', 'NVDA', 'price', 'useful', repo, now);
    await recordFeedback('user-1', 'TSLA', 'volume', 'not-useful', repo, now);

    const index = await getFeedbackIndex('user-1', repo);
    expect(index['NVDA:price']).toBe('useful');
    expect(index['TSLA:volume']).toBe('not-useful');
    expect(index['NVDA:volume']).toBeUndefined();
  });

  it('is empty for a signed-out user', async () => {
    expect(await getFeedbackIndex('', createFakeFeedbackRepo())).toEqual({});
  });
});
