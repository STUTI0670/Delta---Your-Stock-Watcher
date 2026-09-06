import { describe, expect, it } from 'vitest';
import { computePriceBehavior, dailyReturns, describeBehavior } from '@/lib/market/price-behavior';
import { rankByCadence, recommendCadence } from '@/lib/market/monitoring-cadence';
import { LARGE_DAILY_MOVE_PCT, MIN_SESSIONS_FOR_BEHAVIOR } from '@/lib/market/config';

/** Build a close series from a list of daily percentage moves. */
function seriesFromMoves(moves: number[], start = 100) {
  const bars = [{ close: start }];
  let price = start;
  for (const move of moves) {
    price = price * (1 + move / 100);
    bars.push({ close: price });
  }
  return bars;
}

const flat = (n: number, pct: number) => Array.from({ length: n }, (_, i) => (i % 2 ? pct : -pct));

describe('dailyReturns', () => {
  it('computes close-to-close moves', () => {
    const returns = dailyReturns([{ close: 100 }, { close: 110 }, { close: 99 }]);
    expect(returns[0]).toBeCloseTo(10, 5);
    expect(returns[1]).toBeCloseTo(-10, 5);
  });

  it('skips unusable closes rather than inventing a move', () => {
    expect(dailyReturns([{ close: 100 }, { close: 0 }, { close: 110 }])).toHaveLength(0);
    expect(dailyReturns([])).toEqual([]);
    expect(dailyReturns([{ close: 100 }])).toEqual([]);
  });
});

describe('computePriceBehavior', () => {
  it('refuses to describe a stock from too little history', () => {
    const behavior = computePriceBehavior('X', seriesFromMoves(flat(MIN_SESSIONS_FOR_BEHAVIOR - 2, 1)));
    expect(behavior.hasEnoughData).toBe(false);
    expect(behavior.averageAbsDailyMovePct).toBeNull();
    expect(describeBehavior(behavior)).toContain('Not enough trading history');
  });

  it('measures the average absolute daily move', () => {
    const behavior = computePriceBehavior('CALM', seriesFromMoves(flat(20, 1)));
    expect(behavior.hasEnoughData).toBe(true);
    expect(behavior.averageAbsDailyMovePct).toBeCloseTo(1, 1);
    expect(behavior.largeMoveCount).toBe(0);
  });

  it('counts large moves and reports the biggest', () => {
    const behavior = computePriceBehavior('JUMPY', seriesFromMoves([...flat(16, 0.5), 6, -7, 5, -8]));
    expect(behavior.largeMoveCount).toBe(4);
    expect(behavior.maxAbsDailyMovePct).toBeGreaterThanOrEqual(LARGE_DAILY_MOVE_PCT);
  });

  it('reports volatility as dispersion, not direction', () => {
    // A steady climb has movement but little dispersion around its mean.
    const steady = computePriceBehavior('UP', seriesFromMoves(Array(20).fill(1)));
    const choppy = computePriceBehavior('CHOP', seriesFromMoves(flat(20, 1)));

    expect(steady.volatilityPct).toBeLessThan(0.01);
    expect(choppy.volatilityPct).toBeGreaterThan(0.9);
    // Both move about 1% a day on average.
    expect(steady.averageAbsDailyMovePct).toBeCloseTo(choppy.averageAbsDailyMovePct!, 1);
  });
});

describe('recommendCadence', () => {
  const behaviorOf = (moves: number[]) => computePriceBehavior('X', seriesFromMoves(moves));

  it('says check more often for a stock that moves a lot every day', () => {
    const result = recommendCadence({ symbol: 'TSLA', behavior: behaviorOf(flat(20, 4.1)) });
    expect(result.cadence).toBe('more-often');
    expect(result.label).toBe('Check more often');
    expect(result.rationale).toContain('Average daily movement');
  });

  it('says check less often for a consistently quiet stock', () => {
    const result = recommendCadence({ symbol: 'MSFT', behavior: behaviorOf(flat(20, 0.9)) });
    expect(result.cadence).toBe('less-often');
    expect(result.rationale).toContain('No large moves');
  });

  it('leaves a middling stock at the usual cadence', () => {
    const result = recommendCadence({ symbol: 'AAPL', behavior: behaviorOf(flat(20, 1.8)) });
    expect(result.cadence).toBe('as-usual');
  });

  it('escalates a quiet stock that keeps tripping the user own alerts', () => {
    const quiet = behaviorOf(flat(20, 0.9));
    expect(recommendCadence({ symbol: 'X', behavior: quiet }).cadence).toBe('less-often');
    expect(recommendCadence({ symbol: 'X', behavior: quiet, thresholdCrossings: 2 }).cadence).toBe('more-often');
  });

  it('escalates on repeated large moves even when the average is modest', () => {
    const spiky = behaviorOf([...flat(14, 0.4), 5, -6, 4.5, -5, 0.3, -0.2]);
    expect(spiky.largeMoveCount).toBeGreaterThanOrEqual(3);
    expect(recommendCadence({ symbol: 'X', behavior: spiky }).cadence).toBe('more-often');
  });

  it('admits when it cannot say', () => {
    const result = recommendCadence({ symbol: 'NEW', behavior: behaviorOf([1, 2]) });
    expect(result.cadence).toBe('unknown');
    expect(result.label).toBe('Not enough history');
    expect(result.drivers).toHaveLength(0);
  });

  it('never expresses an opinion about buying or selling', () => {
    const forbidden = /\b(buy|sell|invest|undervalued|overvalued|bullish|bearish|target price|recommend buying)\b/i;

    for (const moves of [flat(20, 4.1), flat(20, 0.9), flat(20, 1.8), [1, 2]]) {
      const result = recommendCadence({ symbol: 'X', behavior: behaviorOf(moves), thresholdCrossings: 3 });
      const text = [result.label, result.rationale, ...result.drivers].join(' ');
      expect(text).not.toMatch(forbidden);
    }
  });

  it('shows its working', () => {
    const result = recommendCadence({ symbol: 'X', behavior: behaviorOf(flat(20, 4.1)), thresholdCrossings: 1 });
    expect(result.drivers.some((d) => d.includes('Average daily movement'))).toBe(true);
    expect(result.drivers.some((d) => d.includes('your price alert'))).toBe(true);
  });
});

describe('rankByCadence', () => {
  it('puts the stocks needing most attention first and the unknowable last', () => {
    const behaviorOf = (moves: number[]) => computePriceBehavior('X', seriesFromMoves(moves));
    const ranked = rankByCadence([
      recommendCadence({ symbol: 'QUIET', behavior: behaviorOf(flat(20, 0.9)) }),
      recommendCadence({ symbol: 'NEW', behavior: behaviorOf([1]) }),
      recommendCadence({ symbol: 'BUSY', behavior: behaviorOf(flat(20, 4.1)) }),
      recommendCadence({ symbol: 'MID', behavior: behaviorOf(flat(20, 1.8)) }),
    ]);

    expect(ranked.map((r) => r.symbol)).toEqual(['BUSY', 'MID', 'QUIET', 'NEW']);
  });
});
