/**
 * Currency-aware money formatting.
 *
 * A watchlist is not all-American: VAML.NS trades in rupees and 7809.T in yen.
 * Printing every figure with a "$" is not a cosmetic slip — it states a wrong
 * price. Yahoo tells us the real currency in `meta.currency`, so quotes carry
 * it and every price is rendered in the unit it was actually quoted in.
 *
 * Where a surface only has a ticker and no quote — a stored alert threshold, a
 * digest line — the exchange suffix gives the answer instead. It is a fallback,
 * not a guess we prefer: `currencyFor` always takes the provider's code first.
 *
 * Pure: no React, no database, no network.
 */

interface CurrencyFormat {
  symbol: string;
  /** Where the unit sits relative to the number. */
  position: 'prefix' | 'suffix';
  decimals: number;
}

/**
 * Note `GBp`: the London quote is in *pence*, not pounds, and Yahoo says so
 * with that exact mixed-case code. Rendering 539.7 GBp as "£539.70" overstates
 * the price a hundredfold, so pence get their own entry and their own suffix.
 */
const FORMATS: Record<string, CurrencyFormat> = {
  USD: { symbol: '$', position: 'prefix', decimals: 2 },
  EUR: { symbol: '€', position: 'prefix', decimals: 2 },
  GBP: { symbol: '£', position: 'prefix', decimals: 2 },
  GBP_PENCE: { symbol: 'p', position: 'suffix', decimals: 2 },
  INR: { symbol: '₹', position: 'prefix', decimals: 2 },
  // Yen and won are not quoted in fractional units; two decimals would be noise.
  JPY: { symbol: '¥', position: 'prefix', decimals: 0 },
  KRW: { symbol: '₩', position: 'prefix', decimals: 0 },
  CNY: { symbol: 'CN¥', position: 'prefix', decimals: 2 },
  HKD: { symbol: 'HK$', position: 'prefix', decimals: 2 },
  TWD: { symbol: 'NT$', position: 'prefix', decimals: 2 },
  CAD: { symbol: 'CA$', position: 'prefix', decimals: 2 },
  AUD: { symbol: 'A$', position: 'prefix', decimals: 2 },
  NZD: { symbol: 'NZ$', position: 'prefix', decimals: 2 },
  SGD: { symbol: 'S$', position: 'prefix', decimals: 2 },
  BRL: { symbol: 'R$', position: 'prefix', decimals: 2 },
  CHF: { symbol: 'CHF ', position: 'prefix', decimals: 2 },
  SEK: { symbol: ' kr', position: 'suffix', decimals: 2 },
  NOK: { symbol: ' kr', position: 'suffix', decimals: 2 },
  DKK: { symbol: ' kr', position: 'suffix', decimals: 2 },
  ZAR: { symbol: 'R', position: 'prefix', decimals: 2 },
  MXN: { symbol: 'MX$', position: 'prefix', decimals: 2 },
  ILS: { symbol: '₪', position: 'prefix', decimals: 2 },
};

/** Exchange suffix → the currency that exchange quotes in. */
const SUFFIX_CURRENCY: Record<string, string> = {
  NS: 'INR',
  BO: 'INR',
  T: 'JPY',
  L: 'GBp',
  HK: 'HKD',
  SS: 'CNY',
  SZ: 'CNY',
  KS: 'KRW',
  KQ: 'KRW',
  TW: 'TWD',
  TWO: 'TWD',
  TO: 'CAD',
  V: 'CAD',
  NE: 'CAD',
  AX: 'AUD',
  NZ: 'NZD',
  SI: 'SGD',
  SA: 'BRL',
  SW: 'CHF',
  ST: 'SEK',
  OL: 'NOK',
  CO: 'DKK',
  JO: 'ZAR',
  MX: 'MXN',
  TA: 'ILS',
  PA: 'EUR',
  DE: 'EUR',
  F: 'EUR',
  AS: 'EUR',
  MI: 'EUR',
  MC: 'EUR',
  BR: 'EUR',
  LS: 'EUR',
  HE: 'EUR',
  IR: 'EUR',
  VI: 'EUR',
  AT: 'EUR',
};

export const DEFAULT_CURRENCY = 'USD';

/**
 * The currency a ticker is quoted in, inferred from its exchange suffix.
 * A bare ticker is a US listing, which is the only reason "$" was ever a safe
 * default — it stays the default here, but as a stated rule rather than a
 * hardcoded character.
 */
export function currencyForSymbol(symbol: string | null | undefined): string {
  if (!symbol) return DEFAULT_CURRENCY;
  const dot = symbol.lastIndexOf('.');
  if (dot === -1 || dot === symbol.length - 1) return DEFAULT_CURRENCY;
  return SUFFIX_CURRENCY[symbol.slice(dot + 1).toUpperCase()] ?? DEFAULT_CURRENCY;
}

/**
 * Settle on a currency: what the provider reported, else what the ticker
 * implies. The provider is authoritative — a dual-listed symbol can trade in a
 * currency its suffix would not predict.
 */
export function currencyFor(
  reported: string | null | undefined,
  symbol?: string | null
): string {
  if (typeof reported === 'string' && reported.trim()) return reported.trim();
  return currencyForSymbol(symbol);
}

function formatFor(currency: string): CurrencyFormat | null {
  // "GBp" is case-sensitively distinct from "GBP"; check it before folding case.
  if (currency === 'GBp' || currency === 'GBX') return FORMATS.GBP_PENCE;
  return FORMATS[currency.toUpperCase()] ?? null;
}

/** The unit a price is shown in, e.g. "$", "₹", "p". Used for compact labels. */
export function currencySymbol(currency: string | null | undefined): string {
  if (!currency) return FORMATS.USD.symbol;
  return formatFor(currency)?.symbol.trim() ?? currency.toUpperCase();
}

/**
 * Render an amount in its own currency.
 *
 * A currency we have no entry for is printed with its ISO code rather than
 * being forced into a familiar-looking symbol — "SAR 412.00" is honest, while
 * "$412.00" would not be.
 */
export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined = DEFAULT_CURRENCY
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';

  const code = currency?.trim() || DEFAULT_CURRENCY;
  const format = formatFor(code);
  if (!format) return `${code.toUpperCase()} ${value.toFixed(2)}`;

  const amount = value.toFixed(format.decimals);
  return format.position === 'prefix' ? `${format.symbol}${amount}` : `${amount}${format.symbol}`;
}
