import { describe, expect, it } from 'vitest';
import { parseBars, parseQuote, previousCloseFrom, type ChartResult } from '@/lib/market/yahoo-parse';

const day = 86_400;
const base = 1_788_000_000;

function chartResult(closes: (number | null)[], volumes: (number | null)[] = []): ChartResult {
  return {
    timestamp: closes.map((_, i) => base + i * day),
    indicators: { quote: [{ close: closes, volume: volumes.length ? volumes : closes.map(() => 1_000_000) }] },
  };
}

describe('parseBars', () => {
  it('keeps sessions in order with their volume', () => {
    const bars = parseBars(chartResult([10, 11, 12], [100, 200, 300]));
    expect(bars.map((b) => b.close)).toEqual([10, 11, 12]);
    expect(bars.map((b) => b.volume)).toEqual([100, 200, 300]);
    expect(bars[0].date.getTime()).toBe(base * 1000);
  });

  it('drops padded sessions rather than turning them into flat days', () => {
    const bars = parseBars(chartResult([10, null, 12]));
    expect(bars.map((b) => b.close)).toEqual([10, 12]);
  });

  it('tolerates a missing or malformed payload', () => {
    expect(parseBars(undefined)).toEqual([]);
    expect(parseBars({})).toEqual([]);
    expect(parseBars({ timestamp: [1], indicators: { quote: [{}] } })).toEqual([]);
  });

  it('records volume as null when absent instead of guessing zero', () => {
    const bars = parseBars({
      timestamp: [base],
      indicators: { quote: [{ close: [10], volume: [null] }] },
    });
    expect(bars[0].volume).toBeNull();
  });
});

describe('previousCloseFrom', () => {
  const bars = parseBars(chartResult([100, 376.37, 354.08]));
  /** Quote timestamp on the same UTC day as the newest bar. */
  const liveTime = Math.floor((base + 2 * day) / 1) + 3600;

  it('uses the prior bar when the newest bar is the live session', () => {
    expect(previousCloseFrom(bars, 354.08, { regularMarketTime: liveTime })).toBe(376.37);
  });

  it('uses the newest bar when it is a completed session', () => {
    // Quote is a day later than the newest bar: that bar is the last close.
    const nextDay = liveTime + day;
    expect(previousCloseFrom(bars, 360, { regularMarketTime: nextDay })).toBe(354.08);
  });

  it('matches the live session despite float32 bar closes vs cent-rounded quotes', () => {
    // The real payload: regularMarketPrice 354.08, bar close 354.0799865722656.
    // An equality check on those silently picked the wrong bar and reported 0%.
    const float32Bars = parseBars(chartResult([100, 376.3699951171875, 354.0799865722656]));
    expect(previousCloseFrom(float32Bars, 354.08, { regularMarketTime: liveTime })).toBeCloseTo(376.37, 4);
  });

  it('falls back to a price tolerance when no quote timestamp is given', () => {
    const float32Bars = parseBars(chartResult([100, 376.3699951171875, 354.0799865722656]));
    expect(previousCloseFrom(float32Bars, 354.08)).toBeCloseTo(376.37, 4);
    // A genuinely different price means the newest bar is a completed session.
    expect(previousCloseFrom(float32Bars, 360)).toBeCloseTo(354.08, 4);
  });

  it('ignores chartPreviousClose, which spans the whole requested range', () => {
    // The regression: on a 3-month range this field is three months old, and
    // using it reported a quarterly move as a single day's change.
    const previous = previousCloseFrom(bars, 354.08, { chartPreviousClose: 418.45, regularMarketTime: liveTime });
    expect(previous).toBe(376.37);
    expect(previous).not.toBe(418.45);
  });

  it('falls back to meta only when there are no bars at all', () => {
    expect(previousCloseFrom([], 100, { previousClose: 98 })).toBe(98);
    expect(previousCloseFrom([], 100, {})).toBeNull();
  });

  it('returns null when the only bar is the current session', () => {
    const single = parseBars(chartResult([120]));
    expect(previousCloseFrom(single, 120, { regularMarketTime: base + 3600 })).toBeNull();
  });
});

describe('parseQuote', () => {
  const now = new Date('2026-09-06T15:00:00Z');
  const bars = parseBars(chartResult([100, 376.37, 354.08]));

  it('reports the day move against yesterday, not against the range start', () => {
    const quote = parseQuote(
      'TSLA',
      {
        regularMarketPrice: 354.08,
        chartPreviousClose: 418.45,
        // Same UTC day as the newest bar, i.e. a live session.
        regularMarketTime: base + 2 * day + 3600,
        longName: 'Tesla, Inc.',
      },
      bars,
      now
    );

    expect(quote.price).toBe(354.08);
    expect(quote.previousClose).toBe(376.37);
    expect(quote.dayChangePercent).toBeCloseTo(-5.92, 2);
    // Never the three-month move that chartPreviousClose would have produced.
    expect(quote.dayChangePercent).not.toBeCloseTo(-15.38, 1);
    expect(quote.company).toBe('Tesla, Inc.');
    expect(quote.error).toBeNull();
  });

  it('prefers the long name but accepts the short one', () => {
    expect(parseQuote('X', { regularMarketPrice: 1, shortName: 'Short' }, [], now).company).toBe('Short');
    expect(parseQuote('X', { regularMarketPrice: 1, longName: 'Long', shortName: 'Short' }, [], now).company).toBe('Long');
  });

  it('falls back to the last bar when meta carries no price', () => {
    const quote = parseQuote('TSLA', {}, bars, now);
    expect(quote.price).toBe(354.08);
  });

  it('reports a flat day as 0%, not as a missing value', () => {
    const flat = parseBars(chartResult([100, 200, 200]));
    const quote = parseQuote('X', { regularMarketPrice: 200, regularMarketTime: base + 2 * day + 3600 }, flat, now);
    expect(quote.previousClose).toBe(200);
    expect(quote.dayChangePercent).toBe(0);
  });

  it('fails cleanly when there is no price anywhere', () => {
    const quote = parseQuote('TSLA', {}, [], now);
    expect(quote.price).toBeNull();
    expect(quote.error).toContain('No price returned');
  });

  it('marks an old provider timestamp as stale', () => {
    const old = Math.floor(new Date('2026-09-06T10:00:00Z').getTime() / 1000);
    const quote = parseQuote('TSLA', { regularMarketPrice: 354.08, regularMarketTime: old }, bars, now);
    expect(quote.stale).toBe(true);
    expect(quote.updatedAt?.toISOString()).toBe('2026-09-06T10:00:00.000Z');
  });

  it('leaves the day move null rather than dividing by a bad previous close', () => {
    const quote = parseQuote('TSLA', { regularMarketPrice: 100 }, [], now);
    expect(quote.dayChangePercent).toBeNull();
  });
});
