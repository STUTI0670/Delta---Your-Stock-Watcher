import { describe, expect, it } from 'vitest';
import { explainChange } from '@/lib/market/explain';
import { describeElapsed } from '@/lib/market/freshness';

const base = {
  symbol: 'NVDA',
  hasBaseline: true,
  priceAvailable: true,
};

describe('explainChange', () => {
  it('names the price rule that fired for a large move', () => {
    const result = explainChange({ ...base, changePercent: 7.8, severity: 'large' });

    expect(result.headline).toBe('NVDA moved significantly since your previous check.');
    expect(result.points[0]).toContain('+7.8%');
    expect(result.points[0]).toContain('large-move threshold');
  });

  it('combines price and volume when both crossed', () => {
    const result = explainChange({
      ...base,
      changePercent: 7.8,
      severity: 'large',
      volumeRatio: 2.4,
      volumeUnusual: true,
    });

    expect(result.headline).toContain('moved significantly');
    expect(result.headline).toContain('above its recent average volume');
    expect(result.points.some((p) => p.includes('2.4×'))).toBe(true);
  });

  it('reports normal volume without claiming it as a trigger', () => {
    const result = explainChange({ ...base, changePercent: 1, severity: 'none', volumeRatio: 1.1 });

    expect(result.headline).toContain('did not cross any of the thresholds');
    expect(result.points.some((p) => p.includes('which is normal'))).toBe(true);
  });

  it('explains a quiet stock rather than staying silent', () => {
    const result = explainChange({ ...base, changePercent: 0.3, severity: 'none' });
    expect(result.headline).toContain('did not cross any of the thresholds');
    expect(result.points[0]).toContain('below the');
  });

  it('counts related stories when there are any', () => {
    const result = explainChange({ ...base, changePercent: 5, severity: 'notable', newsCount: 2 });
    expect(result.points.some((p) => p.includes('2 related stories were published'))).toBe(true);
  });

  it('says so when there is no baseline to compare against', () => {
    const result = explainChange({ ...base, hasBaseline: false, changePercent: null, severity: 'none' });
    expect(result.headline).toContain('added since your last check');
  });

  it('says so when the price could not be fetched', () => {
    const result = explainChange({ ...base, priceAvailable: false, changePercent: null, severity: 'none' });
    expect(result.headline).toContain('could not get a current price');
    expect(result.points).toHaveLength(0);
  });

  it('never contradicts the severity it was given', () => {
    // A "none" severity must never produce a headline claiming significance.
    const result = explainChange({ ...base, changePercent: 2.9, severity: 'none' });
    expect(result.headline).not.toContain('moved significantly');
  });
});

describe('describeElapsed', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('reads as hours and minutes for a same-day gap', () => {
    expect(describeElapsed(minutesAgo(6 * 60 + 24), now)).toEqual({ value: '6h 24m', unit: 'ago' });
  });

  it('drops the minutes on an exact hour', () => {
    expect(describeElapsed(minutesAgo(120), now)).toEqual({ value: '2', unit: 'hours' });
    expect(describeElapsed(minutesAgo(60), now)).toEqual({ value: '1', unit: 'hour' });
  });

  it('reads as minutes under an hour', () => {
    expect(describeElapsed(minutesAgo(18), now)).toEqual({ value: '18', unit: 'minutes' });
    expect(describeElapsed(minutesAgo(1), now)).toEqual({ value: '1', unit: 'minute' });
  });

  it('reads as days once past a day', () => {
    expect(describeElapsed(minutesAgo(48 * 60), now)).toEqual({ value: '2', unit: 'days' });
    expect(describeElapsed(minutesAgo(26 * 60), now)).toEqual({ value: '1d 2h', unit: 'ago' });
  });

  it('handles just-now and missing checkpoints', () => {
    expect(describeElapsed(now, now)).toEqual({ value: 'Just', unit: 'now' });
    expect(describeElapsed(null, now)).toBeNull();
  });
});
