import { describe, expect, it } from 'vitest';
import {
  classifyPriceChange,
  detectSymbolChange,
  detectWatchlistChanges,
  isMeaningfulPriceChange,
  isVolumeSpike,
  percentChange,
} from '@/lib/market/change-detection';
import { LARGE_PRICE_CHANGE_PCT, MEANINGFUL_PRICE_CHANGE_PCT } from '@/lib/market/config';

const quote = (price: number | null, extra: Record<string, unknown> = {}) => ({
  symbol: 'X',
  price,
  updatedAt: new Date(),
  stale: false,
  error: null,
  ...extra,
});

describe('percentChange', () => {
  it('computes the move between two prices', () => {
    expect(percentChange(100, 107.4)).toBeCloseTo(7.4, 5);
    expect(percentChange(200, 180)).toBeCloseTo(-10, 5);
  });

  it('returns null when a value is missing or unusable', () => {
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
    expect(percentChange(0, 100)).toBeNull();
    expect(percentChange(Number.NaN, 100)).toBeNull();
  });
});

describe('meaningful price change detection', () => {
  it('treats a move at the threshold as meaningful', () => {
    expect(isMeaningfulPriceChange(MEANINGFUL_PRICE_CHANGE_PCT)).toBe(true);
    expect(isMeaningfulPriceChange(-MEANINGFUL_PRICE_CHANGE_PCT)).toBe(true);
  });

  it('treats a move just below the threshold as not meaningful', () => {
    expect(isMeaningfulPriceChange(MEANINGFUL_PRICE_CHANGE_PCT - 0.01)).toBe(false);
    expect(isMeaningfulPriceChange(0.4)).toBe(false);
    expect(isMeaningfulPriceChange(0)).toBe(false);
  });

  it('is direction agnostic', () => {
    expect(classifyPriceChange(7.4)).toBe('large');
    expect(classifyPriceChange(-7.4)).toBe('large');
  });

  it('separates notable from large moves', () => {
    expect(classifyPriceChange(MEANINGFUL_PRICE_CHANGE_PCT)).toBe('notable');
    expect(classifyPriceChange(LARGE_PRICE_CHANGE_PCT - 0.1)).toBe('notable');
    expect(classifyPriceChange(LARGE_PRICE_CHANGE_PCT)).toBe('large');
  });

  it('returns none for an incomputable change', () => {
    expect(classifyPriceChange(null)).toBe('none');
    expect(isMeaningfulPriceChange(null)).toBe(false);
  });
});

describe('isVolumeSpike', () => {
  it('flags a doubling of volume', () => {
    expect(isVolumeSpike(1_000_000, 2_000_000)).toBe(true);
    expect(isVolumeSpike(1_000_000, 2_400_000)).toBe(true);
  });

  it('ignores volume without a trustworthy baseline', () => {
    expect(isVolumeSpike(undefined, 5_000_000)).toBe(false);
    expect(isVolumeSpike(0, 5_000_000)).toBe(false);
    expect(isVolumeSpike(1_000_000, undefined)).toBe(false);
  });

  it('does not flag ordinary volume', () => {
    expect(isVolumeSpike(1_000_000, 1_200_000)).toBe(false);
  });
});

describe('detectSymbolChange — comparison against the checkpoint', () => {
  const snapshot = { symbol: 'NVDA', price: 100, capturedAt: new Date('2026-09-05T18:00:00Z') };

  it('surfaces a significant move with an explanation', () => {
    const result = detectSymbolChange({
      symbol: 'NVDA',
      company: 'NVIDIA Corp',
      snapshot,
      quote: quote(107.4),
    });

    expect(result.changePercent).toBeCloseTo(7.4, 5);
    expect(result.isMeaningful).toBe(true);
    expect(result.severity).toBe('large');
    expect(result.summary).toBe('Large movement since your last visit.');
    expect(result.reasons.some((r) => r.kind === 'price')).toBe(true);
  });

  it('reports a small move as no significant change', () => {
    const result = detectSymbolChange({
      symbol: 'AAPL',
      company: 'Apple Inc',
      snapshot: { symbol: 'AAPL', price: 200, capturedAt: new Date() },
      quote: quote(200.8),
    });

    expect(result.changePercent).toBeCloseTo(0.4, 5);
    expect(result.isMeaningful).toBe(false);
    expect(result.summary).toBe('No significant change.');
    expect(result.reasons).toHaveLength(0);
  });

  it('measures against the checkpoint rather than the intraday change', () => {
    const result = detectSymbolChange({
      symbol: 'TSLA',
      company: 'Tesla Inc',
      snapshot: { symbol: 'TSLA', price: 400, capturedAt: new Date() },
      // Today's move is flat, but it has fallen 12.5% since the last check.
      quote: quote(350, { dayChangePercent: 0.2 }),
    });

    expect(result.changePercent).toBeCloseTo(-12.5, 5);
    expect(result.dayChangePercent).toBe(0.2);
    expect(result.isMeaningful).toBe(true);
  });

  it('handles a first-time symbol with no baseline', () => {
    const result = detectSymbolChange({
      symbol: 'MSFT',
      company: 'Microsoft',
      snapshot: null,
      quote: quote(410),
    });

    expect(result.hasBaseline).toBe(false);
    expect(result.changePercent).toBeNull();
    expect(result.isMeaningful).toBe(false);
    expect(result.summary).toContain('First time tracked');
  });

  it('degrades gracefully when the price is unavailable', () => {
    const result = detectSymbolChange({
      symbol: 'NVDA',
      company: 'NVIDIA Corp',
      snapshot,
      quote: quote(null, { error: 'Provider responded 429.', stale: true }),
    });

    expect(result.currentPrice).toBeNull();
    expect(result.isMeaningful).toBe(false);
    expect(result.error).toBe('Provider responded 429.');
    expect(result.summary).toBe('Price data unavailable right now.');
  });

  it('adds volume and news context only alongside a real price move', () => {
    const moved = detectSymbolChange({
      symbol: 'NVDA',
      company: 'NVIDIA Corp',
      snapshot: { symbol: 'NVDA', price: 100, volume: 1_000_000, capturedAt: new Date() },
      quote: quote(108, { volume: 2_400_000 }),
      newsCount: 2,
    });
    expect(moved.reasons.map((r) => r.kind)).toEqual(['price', 'volume', 'news']);

    const flat = detectSymbolChange({
      symbol: 'AAPL',
      company: 'Apple Inc',
      snapshot: { symbol: 'AAPL', price: 100, capturedAt: new Date() },
      quote: quote(100.2),
      newsCount: 5,
    });
    // News alone must not promote a flat stock into "Needs attention".
    expect(flat.isMeaningful).toBe(false);
    expect(flat.reasons).toHaveLength(0);
  });
});

describe('detectWatchlistChanges', () => {
  it('splits the watchlist and ranks attention items by magnitude', () => {
    const { changes, needsAttention } = detectWatchlistChanges([
      {
        symbol: 'AAPL',
        company: 'Apple Inc',
        snapshot: { symbol: 'AAPL', price: 200, capturedAt: new Date() },
        quote: quote(200.8),
      },
      {
        symbol: 'NVDA',
        company: 'NVIDIA Corp',
        snapshot: { symbol: 'NVDA', price: 100, capturedAt: new Date() },
        quote: quote(107.4),
      },
      {
        symbol: 'TSLA',
        company: 'Tesla Inc',
        snapshot: { symbol: 'TSLA', price: 100, capturedAt: new Date() },
        quote: quote(95.8),
      },
    ]);

    expect(changes).toHaveLength(3);
    expect(needsAttention.map((c) => c.symbol)).toEqual(['NVDA', 'TSLA']);
    expect(needsAttention[0].changePercent).toBeCloseTo(7.4, 5);
  });

  it('returns an empty attention list when nothing moved', () => {
    const { needsAttention } = detectWatchlistChanges([
      {
        symbol: 'AAPL',
        company: 'Apple Inc',
        snapshot: { symbol: 'AAPL', price: 200, capturedAt: new Date() },
        quote: quote(200.5),
      },
    ]);

    expect(needsAttention).toHaveLength(0);
  });
});
