import { describe, expect, it } from 'vitest';
import { bandFor, computeAttentionScore, contributingFactors } from '@/lib/market/attention-score';
import { computePriceBehavior } from '@/lib/market/price-behavior';
import { ATTENTION_BANDS } from '@/lib/market/config';

/** A stock whose typical day is ~1%. */
const calmBehavior = computePriceBehavior(
  'CALM',
  Array.from({ length: 21 }, (_, i) => ({ close: 100 * 1.01 ** (i % 2 ? 1 : 0) + (i % 2 ? 0 : 0.0) }))
);

/** Explicit behaviour stub, so the score's use of it is unambiguous. */
const behaviorWithAverage = (averageAbsDailyMovePct: number) => ({
  symbol: 'X',
  sessions: 20,
  hasEnoughData: true,
  averageAbsDailyMovePct,
  volatilityPct: averageAbsDailyMovePct,
  maxAbsDailyMovePct: averageAbsDailyMovePct * 3,
  largeMoveCount: 0,
});

describe('bandFor', () => {
  it('maps totals onto the documented bands', () => {
    expect(bandFor(0)).toBe('normal');
    expect(bandFor(ATTENTION_BANDS.worthWatching - 0.01)).toBe('normal');
    expect(bandFor(ATTENTION_BANDS.worthWatching)).toBe('watch');
    expect(bandFor(ATTENTION_BANDS.important - 0.01)).toBe('watch');
    expect(bandFor(ATTENTION_BANDS.important)).toBe('critical');
    expect(bandFor(10)).toBe('critical');
  });
});

describe('price component', () => {
  it('scores by size of move', () => {
    expect(computeAttentionScore({ changePercent: 0.5 }).factors[0].rawPoints).toBe(0);
    expect(computeAttentionScore({ changePercent: 2 }).factors[0].rawPoints).toBe(1);
    expect(computeAttentionScore({ changePercent: 4 }).factors[0].rawPoints).toBe(2);
    expect(computeAttentionScore({ changePercent: 7 }).factors[0].rawPoints).toBe(3);
  });

  it('is direction agnostic', () => {
    expect(computeAttentionScore({ changePercent: -7 }).factors[0].rawPoints).toBe(3);
  });

  it('adds a point when the move is unusual for that particular stock', () => {
    const routine = computeAttentionScore({ changePercent: 4, behavior: behaviorWithAverage(3) });
    const remarkable = computeAttentionScore({ changePercent: 4, behavior: behaviorWithAverage(1) });

    expect(routine.factors[0].rawPoints).toBe(2);
    expect(remarkable.factors[0].rawPoints).toBe(3);
    expect(remarkable.factors[0].text).toContain('typical daily move');
  });

  it('reports an unavailable price comparison rather than scoring zero silently', () => {
    const score = computeAttentionScore({ changePercent: null });
    expect(score.factors[0].unavailable).toBe(true);
    expect(score.unavailableSignals).toContain('price');
  });
});

describe('volume component', () => {
  it('scores a spike and stays quiet on normal volume', () => {
    expect(computeAttentionScore({ changePercent: 0, volumeRatio: 1.2 }).factors[1].rawPoints).toBe(0);
    expect(computeAttentionScore({ changePercent: 0, volumeRatio: 2.4 }).factors[1].rawPoints).toBe(1);
    expect(computeAttentionScore({ changePercent: 0, volumeRatio: 3.5 }).factors[1].rawPoints).toBe(2);
  });

  it('separates "no baseline" from "normal volume"', () => {
    const missing = computeAttentionScore({ changePercent: 0, volumeUnavailable: true });
    expect(missing.factors[1].unavailable).toBe(true);
    expect(missing.unavailableSignals).toContain('volume');

    const normal = computeAttentionScore({ changePercent: 0, volumeRatio: 1 });
    expect(normal.factors[1].unavailable).toBeUndefined();
    expect(normal.factors[1].text).toContain('normal');
  });
});

describe('event and threshold components', () => {
  it('scores stories', () => {
    expect(computeAttentionScore({ changePercent: 0, newsCount: 0 }).factors[2].rawPoints).toBe(0);
    expect(computeAttentionScore({ changePercent: 0, newsCount: 1 }).factors[2].rawPoints).toBe(1);
    expect(computeAttentionScore({ changePercent: 0, newsCount: 5 }).factors[2].rawPoints).toBe(2);
  });

  it('distinguishes unchecked news from no news', () => {
    const unchecked = computeAttentionScore({ changePercent: 0, newsUnavailable: true });
    expect(unchecked.factors[2].unavailable).toBe(true);
    expect(unchecked.factors[2].text).toContain('could not be checked');
  });

  it('scores the user own triggered alerts, capped', () => {
    expect(computeAttentionScore({ changePercent: 0, thresholdCrossings: 0 }).factors[3].rawPoints).toBe(0);
    expect(computeAttentionScore({ changePercent: 0, thresholdCrossings: 1 }).factors[3].rawPoints).toBe(1);
    expect(computeAttentionScore({ changePercent: 0, thresholdCrossings: 9 }).factors[3].rawPoints).toBe(2);
  });
});

describe('total and banding', () => {
  it('sums the components', () => {
    const score = computeAttentionScore({
      changePercent: 7,
      behavior: behaviorWithAverage(1),
      volumeRatio: 2.4,
      newsCount: 2,
      thresholdCrossings: 1,
    });
    // price 3 (+1 unusual) + volume 1 + event 1 + threshold 1
    expect(score.total).toBe(7);
    expect(score.band).toBe('critical');
  });

  it('leaves a quiet stock at normal', () => {
    const score = computeAttentionScore({ changePercent: 0.3, volumeRatio: 1, newsCount: 0 });
    expect(score.total).toBe(0);
    expect(score.band).toBe('normal');
  });

  it('reaches worth-watching on accumulated small signals alone', () => {
    // No single signal is dramatic, but together they deserve a look.
    const score = computeAttentionScore({ changePercent: 2, volumeRatio: 2.2, newsCount: 1 });
    expect(score.total).toBe(3);
    expect(score.band).toBe('watch');
  });
});

describe('personalization weighting', () => {
  it('scales a signal that fired', () => {
    const score = computeAttentionScore({ changePercent: 7, weights: { price: 1.5 } });
    expect(score.factors[0].rawPoints).toBe(3);
    expect(score.factors[0].points).toBe(4.5);
  });

  it('cannot resurrect a signal that scored zero', () => {
    const score = computeAttentionScore({ changePercent: 0.1, weights: { price: 1.5 } });
    expect(score.factors[0].points).toBe(0);
  });

  it('cannot erase a measured fact, only reduce its weight', () => {
    const score = computeAttentionScore({ changePercent: 7, weights: { price: 0.5 } });
    expect(score.factors[0].points).toBe(1.5);
    expect(score.factors[0].text).toContain('+7.0%');
  });

  it('ignores nonsensical weights', () => {
    for (const bad of [0, -1, Number.NaN, undefined]) {
      const score = computeAttentionScore({ changePercent: 7, weights: { price: bad as number } });
      expect(score.factors[0].points).toBe(3);
    }
  });
});

describe('contributingFactors — "why am I seeing this?"', () => {
  it('returns only what contributed, strongest first', () => {
    const score = computeAttentionScore({
      changePercent: 7,
      volumeRatio: 2.4,
      newsCount: 1,
      thresholdCrossings: 0,
    });
    const why = contributingFactors(score);

    expect(why.map((f) => f.kind)).toEqual(['price', 'volume', 'event']);
    expect(why[0].points).toBeGreaterThanOrEqual(why[1].points);
    expect(why.some((f) => f.kind === 'threshold')).toBe(false);
  });

  it('never explains more than the score accounts for', () => {
    const score = computeAttentionScore({ changePercent: 7, volumeRatio: 2.4 });
    const explained = contributingFactors(score).reduce((sum, f) => sum + f.points, 0);
    expect(explained).toBe(score.total);
  });

  it('has nothing to explain for a quiet stock', () => {
    expect(contributingFactors(computeAttentionScore({ changePercent: 0.2 }))).toHaveLength(0);
  });
});

describe('behaviour statistics feeding the score', () => {
  it('is usable with real computed behaviour', () => {
    expect(calmBehavior.hasEnoughData).toBe(true);
    const score = computeAttentionScore({ changePercent: 5, behavior: calmBehavior });
    expect(score.total).toBeGreaterThan(0);
  });
});
