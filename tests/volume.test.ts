import { describe, expect, it } from 'vitest';
import { computeVolumeBaseline, describeVolume, sparklineSeries } from '@/lib/market/volume';
import { MIN_SESSIONS_FOR_VOLUME_BASELINE } from '@/lib/market/config';

const bars = (volumes: (number | null)[], close = 100) =>
  volumes.map((volume) => ({ close, volume }));

describe('computeVolumeBaseline', () => {
  it('needs a minimum history before it will report a baseline', () => {
    const short = computeVolumeBaseline('NVDA', bars(Array(MIN_SESSIONS_FOR_VOLUME_BASELINE - 1).fill(1_000_000)));
    expect(short.hasBaseline).toBe(false);
    expect(short.ratio).toBeNull();
    expect(short.isUnusual).toBe(false);
  });

  it('averages the prior sessions and compares the latest against them', () => {
    // Ten sessions at 1M, then one at 3M.
    const baseline = computeVolumeBaseline('NVDA', bars([...Array(10).fill(1_000_000), 3_000_000]));

    expect(baseline.hasBaseline).toBe(true);
    expect(baseline.averageVolume).toBe(1_000_000);
    expect(baseline.latestVolume).toBe(3_000_000);
    expect(baseline.ratio).toBeCloseTo(3, 5);
    expect(baseline.isUnusual).toBe(true);
  });

  it('excludes the latest session from its own average', () => {
    // If the spike were included, the average would be pulled up and the ratio down.
    const baseline = computeVolumeBaseline('NVDA', bars([...Array(9).fill(1_000_000), 10_000_000]));
    expect(baseline.averageVolume).toBe(1_000_000);
    expect(baseline.ratio).toBeCloseTo(10, 5);
  });

  it('does not flag ordinary volume', () => {
    const baseline = computeVolumeBaseline('AAPL', bars([...Array(10).fill(1_000_000), 1_300_000]));
    expect(baseline.ratio).toBeCloseTo(1.3, 5);
    expect(baseline.isUnusual).toBe(false);
  });

  it('flags exactly at the 2x threshold', () => {
    const baseline = computeVolumeBaseline('AAPL', bars([...Array(10).fill(1_000_000), 2_000_000]));
    expect(baseline.isUnusual).toBe(true);
  });

  it('ignores missing and zero volumes rather than treating them as data', () => {
    const baseline = computeVolumeBaseline('TSLA', bars([...Array(10).fill(1_000_000), null, 0, 2_500_000]));
    expect(baseline.averageVolume).toBe(1_000_000);
    expect(baseline.latestVolume).toBe(2_500_000);
    expect(baseline.isUnusual).toBe(true);
  });

  it('reports no baseline when volume is entirely absent', () => {
    const baseline = computeVolumeBaseline('TSLA', bars(Array(20).fill(null)));
    expect(baseline.hasBaseline).toBe(false);
    expect(baseline.latestVolume).toBeNull();
    expect(describeVolume(baseline)).toBeNull();
  });
});

describe('describeVolume', () => {
  it('phrases the ratio the way the UI reads it', () => {
    const baseline = computeVolumeBaseline('NVDA', bars([...Array(10).fill(1_000_000), 2_400_000]));
    expect(describeVolume(baseline)).toBe('2.4× normal');
  });
});

describe('sparklineSeries', () => {
  it('normalises closes into 0..1 with the low at 0 and the high at 1', () => {
    const series = sparklineSeries([{ close: 10 }, { close: 20 }, { close: 15 }]);
    expect(series[0]).toBeCloseTo(0, 5);
    expect(series[1]).toBeCloseTo(1, 5);
    expect(series[2]).toBeCloseTo(0.5, 5);
  });

  it('centres a flat series rather than dividing by zero', () => {
    expect(sparklineSeries([{ close: 50 }, { close: 50 }, { close: 50 }])).toEqual([0.5, 0.5, 0.5]);
  });

  it('returns nothing to draw for an unusable series', () => {
    expect(sparklineSeries([])).toEqual([]);
    expect(sparklineSeries([{ close: 10 }])).toEqual([]);
  });

  it('keeps only the most recent points', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ close: 100 + i }));
    expect(sparklineSeries(many, 30)).toHaveLength(30);
  });
});
