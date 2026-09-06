import { describe, expect, it } from 'vitest';
import {
  deriveSignalWeights,
  describeWeights,
  isPersonalized,
  neutralWeights,
  type FeedbackRecord,
} from '@/lib/market/personalization';
import { computeAttentionScore } from '@/lib/market/attention-score';
import {
  FEEDBACK_LOOKBACK_DAYS,
  FEEDBACK_WEIGHT_MAX,
  FEEDBACK_WEIGHT_MIN,
  FEEDBACK_WEIGHT_STEP,
} from '@/lib/market/config';
import { summarizeDigest } from '@/lib/services/digest.service';
import type { StoredAlertEvent } from '@/lib/services/repositories';

const now = new Date('2026-09-06T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

const vote = (
  signalKind: FeedbackRecord['signalKind'],
  v: FeedbackRecord['vote'],
  ageDays = 1
): FeedbackRecord => ({ signalKind, vote: v, createdAt: daysAgo(ageDays) });

describe('deriveSignalWeights', () => {
  it('starts neutral with no feedback', () => {
    expect(deriveSignalWeights([], now)).toEqual(neutralWeights());
    expect(isPersonalized(neutralWeights())).toBe(false);
  });

  it('moves one step per net vote', () => {
    const up = deriveSignalWeights([vote('price', 'useful')], now);
    expect(up.price).toBeCloseTo(1 + FEEDBACK_WEIGHT_STEP, 6);

    const down = deriveSignalWeights([vote('event', 'not-useful')], now);
    expect(down.event).toBeCloseTo(1 - FEEDBACK_WEIGHT_STEP, 6);
  });

  it('nets opposing votes against each other', () => {
    const weights = deriveSignalWeights([vote('price', 'useful'), vote('price', 'not-useful')], now);
    expect(weights.price).toBeCloseTo(1, 6);
  });

  it('clamps, so no signal can be silenced or allowed to dominate', () => {
    const manyDown = Array.from({ length: 50 }, () => vote('event', 'not-useful'));
    const manyUp = Array.from({ length: 50 }, () => vote('price', 'useful'));

    expect(deriveSignalWeights(manyDown, now).event).toBe(FEEDBACK_WEIGHT_MIN);
    expect(deriveSignalWeights(manyUp, now).price).toBe(FEEDBACK_WEIGHT_MAX);
    expect(FEEDBACK_WEIGHT_MIN).toBeGreaterThan(0);
  });

  it('ignores votes older than the lookback window', () => {
    const stale = deriveSignalWeights([vote('price', 'useful', FEEDBACK_LOOKBACK_DAYS + 5)], now);
    expect(stale.price).toBeCloseTo(1, 6);

    const fresh = deriveSignalWeights([vote('price', 'useful', FEEDBACK_LOOKBACK_DAYS - 1)], now);
    expect(fresh.price).toBeGreaterThan(1);
  });

  it('ignores malformed records rather than throwing', () => {
    const weights = deriveSignalWeights(
      [
        { signalKind: 'nonsense' as never, vote: 'useful', createdAt: daysAgo(1) },
        { signalKind: 'price', vote: 'useful', createdAt: 'not a date' },
      ],
      now
    );
    expect(weights).toEqual(neutralWeights());
  });

  it('keeps signals independent', () => {
    const weights = deriveSignalWeights([vote('price', 'not-useful'), vote('volume', 'useful')], now);
    expect(weights.price).toBeLessThan(1);
    expect(weights.volume).toBeGreaterThan(1);
    expect(weights.event).toBe(1);
    expect(weights.threshold).toBe(1);
  });
});

describe('personalization applied to the score', () => {
  it('reorders which signal dominates without changing the measurements', () => {
    const input = { changePercent: 4, volumeRatio: 3.5, newsCount: 0, thresholdCrossings: 0 };

    const neutral = computeAttentionScore(input);
    const volumeLover = computeAttentionScore({
      ...input,
      weights: deriveSignalWeights(Array.from({ length: 4 }, () => vote('volume', 'useful')), now),
    });

    // Same underlying facts.
    expect(volumeLover.factors[0].text).toBe(neutral.factors[0].text);
    expect(volumeLover.factors[1].text).toBe(neutral.factors[1].text);
    // But volume now carries more of the total.
    expect(volumeLover.factors[1].points).toBeGreaterThan(neutral.factors[1].points);
    expect(volumeLover.total).toBeGreaterThan(neutral.total);
  });

  it('a heavily downvoted signal still contributes something', () => {
    const weights = deriveSignalWeights(Array.from({ length: 50 }, () => vote('event', 'not-useful')), now);
    const score = computeAttentionScore({ changePercent: 0, newsCount: 5, weights });

    expect(score.factors[2].points).toBeGreaterThan(0);
    expect(score.factors[2].text).toContain('5 related stories');
  });
});

describe('describeWeights', () => {
  it('says nothing when nothing is tuned', () => {
    expect(describeWeights(neutralWeights())).toEqual([]);
  });

  it('describes each tuned signal in plain words', () => {
    const notes = describeWeights(deriveSignalWeights([vote('price', 'useful'), vote('event', 'not-useful')], now));
    expect(notes.join(' ')).toContain('Price moves');
    expect(notes.join(' ')).toContain('more prominently');
    expect(notes.join(' ')).toContain('Related news');
    expect(notes.join(' ')).toContain('less prominently');
  });
});

describe('summarizeDigest', () => {
  const event = (overrides: Partial<StoredAlertEvent> = {}): StoredAlertEvent => ({
    userId: 'u1',
    alertId: 'a1',
    symbol: 'NVDA',
    company: 'NVIDIA',
    direction: 'buy',
    threshold: 165,
    triggeredPrice: 164,
    message: 'x',
    triggeredAt: now,
    notifiedAt: null,
    notificationError: null,
    ...overrides,
  });

  it('rolls several crossings into one statement', () => {
    const summary = summarizeDigest([
      event(),
      event({ symbol: 'TSLA', direction: 'sell', threshold: 350, triggeredPrice: 352 }),
    ]);

    expect(summary.totalCrossings).toBe(2);
    expect(summary.symbolCount).toBe(2);
    expect(summary.buyCount).toBe(1);
    expect(summary.sellCount).toBe(1);
    expect(summary.headline).toBe('2 price alerts were triggered across 2 stocks.');
    expect(summary.lines[0]).toContain('NVDA fell to $164.00');
    expect(summary.lines[1]).toContain('TSLA rose to $352.00');
  });

  it('reads correctly for a single crossing', () => {
    const summary = summarizeDigest([event()]);
    expect(summary.headline).toBe('1 price alert was triggered across 1 stock.');
  });

  it('counts distinct stocks, not events', () => {
    const summary = summarizeDigest([event(), event({ direction: 'sell', threshold: 200, triggeredPrice: 201 })]);
    expect(summary.totalCrossings).toBe(2);
    expect(summary.symbolCount).toBe(1);
  });
});
