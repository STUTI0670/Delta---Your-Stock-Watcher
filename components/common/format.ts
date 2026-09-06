/** Shared display formatting. Keeps figures identical across every surface. */

import { formatMoney } from '@/lib/market/currency';

/**
 * A price in the currency it was actually quoted in.
 *
 * Callers that hold a change or quote pass its `currency`; those that only
 * know the ticker pass `currencyForSymbol(symbol)`. Omitting it means US
 * dollars, which is right for a bare ticker and wrong for anything else — so
 * prefer passing the real one wherever it is available.
 */
export function formatPrice(value: number | null | undefined, currency?: string | null): string {
  return formatMoney(value, currency);
}

export function formatMove(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  // A value that rounds away to zero must not keep a misleading sign.
  const rounded = Math.abs(value) < 0.5 / 10 ** digits ? 0 : value;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(digits)}%`;
}

/** Direction class. Returns the neutral tone for a missing or flat value. */
export function moveTone(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'wp-flat';
  return value > 0 ? 'wp-up' : 'wp-down';
}

export function formatVolume(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

/** The one-word verdict the product gives a stock. Shown as a pill everywhere. */
export function verdictLabel(level: 'critical' | 'watch' | 'normal'): string {
  if (level === 'critical') return 'Significant';
  if (level === 'watch') return 'Worth a look';
  return 'Quiet';
}
