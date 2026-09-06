import { describe, expect, it } from 'vitest';
import { describeAge, describeCheckpointTime, describeQuoteStatus, isStale } from '@/lib/market/freshness';
import { STALE_QUOTE_AFTER_MS } from '@/lib/market/config';
import { detectSymbolChange } from '@/lib/market/change-detection';

const now = new Date('2026-09-06T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe('isStale', () => {
  it('treats a recent quote as fresh', () => {
    expect(isStale(minutesAgo(5), now)).toBe(false);
  });

  it('treats a quote past the window as stale', () => {
    expect(isStale(new Date(now.getTime() - STALE_QUOTE_AFTER_MS - 1000), now)).toBe(true);
  });

  it('treats a missing or invalid timestamp as stale', () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale('not a date', now)).toBe(true);
  });
});

describe('describeAge', () => {
  it('describes recent, minute, hour and day scales', () => {
    expect(describeAge(minutesAgo(0), now)).toBe('just now');
    expect(describeAge(minutesAgo(18), now)).toBe('18 min ago');
    expect(describeAge(minutesAgo(3 * 60), now)).toBe('3 hr ago');
    expect(describeAge(minutesAgo(2 * 24 * 60), now)).toBe('2 days ago');
  });

  it('never claims a time it does not have', () => {
    expect(describeAge(null, now)).toBe('never updated');
  });
});

describe('describeCheckpointTime', () => {
  it('phrases the previous check relative to now', () => {
    expect(describeCheckpointTime(new Date('2026-09-06T09:30:00Z'), now)).toContain('today at');
    expect(describeCheckpointTime(new Date('2026-09-05T18:20:00Z'), now)).toContain('yesterday at');
    expect(describeCheckpointTime(new Date('2026-08-30T18:20:00Z'), now)).toContain('Aug 30');
  });

  it('handles a user who has never checked', () => {
    expect(describeCheckpointTime(null, now)).toBe('this is your first check');
  });
});

describe('degraded quotes keep their meaning', () => {
  it('still compares a last-known price but keeps the error visible', () => {
    const result = detectSymbolChange({
      symbol: 'NVDA',
      company: 'NVIDIA Corp',
      snapshot: { symbol: 'NVDA', price: 100, capturedAt: minutesAgo(600) },
      quote: {
        symbol: 'NVDA',
        price: 107.4,
        updatedAt: minutesAgo(45),
        stale: true,
        error: 'Provider responded 500. Showing the last price we received.',
      },
    });

    expect(result.changePercent).toBeCloseTo(7.4, 5);
    expect(result.summary).toBe('Large movement since your last visit.');
    expect(result.stale).toBe(true);
    expect(result.error).toContain('last price we received');
  });

  it('says nothing is available when there is no price at all', () => {
    const result = detectSymbolChange({
      symbol: 'TSLA',
      company: 'Tesla Inc',
      snapshot: { symbol: 'TSLA', price: 100, capturedAt: minutesAgo(600) },
      quote: { symbol: 'TSLA', price: null, updatedAt: null, stale: true, error: 'Provider responded 500.' },
    });

    expect(result.summary).toBe('Price data unavailable right now.');
    expect(result.isMeaningful).toBe(false);
  });
});

describe('describeQuoteStatus', () => {
  // Sunday 6 Sep 2026, 12:00 UTC — the exchanges have been shut since Friday.
  const sunday = new Date('2026-09-06T12:00:00Z');

  it('calls a recent quote live, without qualification', () => {
    const status = describeQuoteStatus(new Date(sunday.getTime() - 2 * 60_000), sunday);
    expect(status.tone).toBe('live');
  });

  it('calls a quote stale within a session delayed', () => {
    const status = describeQuoteStatus(new Date(sunday.getTime() - 90 * 60_000), sunday);
    expect(status.tone).toBe('delayed');
    expect(status.text).toContain('Updated');
  });

  it('does not call a closed market delayed', () => {
    // Friday's close, ~46 hours earlier.
    const friday = new Date('2026-09-04T10:00:00Z');
    const status = describeQuoteStatus(friday, sunday);
    expect(status.tone).toBe('closed');
    expect(status.text).toContain('Last price');
    expect(status.text).not.toContain('delayed');
  });

  it('states a plain timestamp rather than naming a session it cannot verify', () => {
    // A US close read from IST lands on the local Saturday, so any weekday
    // possessive ("Friday's close") would be wrong for the reader.
    const status = describeQuoteStatus(new Date('2026-08-28T10:00:00Z'), sunday);
    expect(status.tone).toBe('closed');
    expect(status.text).toContain('Last price');
    expect(status.text).not.toMatch(/yesterday|today/i);
  });

  it('never claims a price it does not have', () => {
    expect(describeQuoteStatus(null, sunday).tone).toBe('unavailable');
  });
});
