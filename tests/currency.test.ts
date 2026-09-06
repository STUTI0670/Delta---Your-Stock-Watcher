import { describe, expect, it } from 'vitest';
import { currencyFor, currencyForSymbol, currencySymbol, formatMoney } from '@/lib/market/currency';
import { parseQuote } from '@/lib/market/yahoo-parse';
import { detectSymbolChange } from '@/lib/market/change-detection';
import { buildAlertMessage } from '@/lib/market/alert-rules';
import { summarizeDigest } from '@/lib/services/digest.service';
import type { StoredAlertEvent } from '@/lib/services/repositories';

describe('currencyForSymbol', () => {
  it('treats a bare ticker as a US listing', () => {
    expect(currencyForSymbol('NVDA')).toBe('USD');
    expect(currencyForSymbol('TSLA')).toBe('USD');
  });

  it('reads the exchange suffix', () => {
    expect(currencyForSymbol('VAML.NS')).toBe('INR');
    expect(currencyForSymbol('RELIANCE.BO')).toBe('INR');
    expect(currencyForSymbol('7809.T')).toBe('JPY');
    expect(currencyForSymbol('BP.L')).toBe('GBp');
    expect(currencyForSymbol('AIR.PA')).toBe('EUR');
    expect(currencyForSymbol('SHOP.TO')).toBe('CAD');
  });

  it('is case-insensitive about the suffix', () => {
    expect(currencyForSymbol('vaml.ns')).toBe('INR');
  });

  it('falls back to dollars for an unknown or malformed suffix', () => {
    expect(currencyForSymbol('FOO.ZZZ')).toBe('USD');
    expect(currencyForSymbol('FOO.')).toBe('USD');
    expect(currencyForSymbol('')).toBe('USD');
    expect(currencyForSymbol(null)).toBe('USD');
  });
});

describe('currencyFor', () => {
  it('prefers what the provider reported', () => {
    // A dual listing can trade in a currency the suffix would not predict.
    expect(currencyFor('USD', 'ABC.L')).toBe('USD');
  });

  it('falls back to the ticker when the provider said nothing', () => {
    expect(currencyFor(null, '7809.T')).toBe('JPY');
    expect(currencyFor('   ', 'VAML.NS')).toBe('INR');
    expect(currencyFor(undefined, 'NVDA')).toBe('USD');
  });
});

describe('formatMoney', () => {
  it('renders each currency in its own unit', () => {
    expect(formatMoney(230.36, 'USD')).toBe('$230.36');
    expect(formatMoney(439, 'INR')).toBe('₹439.00');
    expect(formatMoney(12.5, 'EUR')).toBe('€12.50');
  });

  it('drops decimals for currencies that are not quoted in fractions', () => {
    expect(formatMoney(1325, 'JPY')).toBe('¥1325');
    expect(formatMoney(74800, 'KRW')).toBe('₩74800');
  });

  it('treats a London quote as pence, not pounds', () => {
    // GBp is a hundredth of GBP; "£539.70" would overstate this by 100x.
    expect(formatMoney(539.7, 'GBp')).toBe('539.70p');
    expect(formatMoney(539.7, 'GBP')).toBe('£539.70');
  });

  it('places a suffix unit after the number', () => {
    expect(formatMoney(140.25, 'SEK')).toBe('140.25 kr');
  });

  it('names an unmapped currency rather than faking a familiar symbol', () => {
    expect(formatMoney(412, 'SAR')).toBe('SAR 412.00');
  });

  it('defaults to dollars only when no currency is given', () => {
    expect(formatMoney(10)).toBe('$10.00');
    expect(formatMoney(10, null)).toBe('$10.00');
  });

  it('returns the em dash for a missing or non-finite amount', () => {
    expect(formatMoney(null, 'INR')).toBe('—');
    expect(formatMoney(undefined, 'INR')).toBe('—');
    expect(formatMoney(Number.NaN, 'INR')).toBe('—');
  });
});

describe('currencySymbol', () => {
  it('gives the bare unit for compact labels', () => {
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('SEK')).toBe('kr');
    expect(currencySymbol(null)).toBe('$');
  });
});

describe('currency reaches the data path', () => {
  it('carries the provider currency onto the quote', () => {
    const quote = parseQuote('VAML.NS', { regularMarketPrice: 439, currency: 'INR' }, []);
    expect(quote.currency).toBe('INR');
  });

  it('infers a currency when the provider omitted it', () => {
    const quote = parseQuote('7809.T', { regularMarketPrice: 1325 }, []);
    expect(quote.currency).toBe('JPY');
  });

  it('puts the currency on the change the interface renders', () => {
    const change = detectSymbolChange({
      symbol: 'VAML.NS',
      company: 'Vaml',
      quote: { symbol: 'VAML.NS', price: 439, currency: 'INR' },
      snapshot: { symbol: 'VAML.NS', price: 400, capturedAt: new Date() },
    });
    expect(change.currency).toBe('INR');
  });

  it('states an alert threshold in the stock\u2019s own currency', () => {
    expect(buildAlertMessage('7809.T', 'buy', 1400, 1325)).toBe(
      '7809.T fell to ¥1325, crossing your buy threshold of ¥1400.'
    );
  });

  it('states digest lines in each stock\u2019s own currency', () => {
    const event = (symbol: string, triggeredPrice: number, threshold: number): StoredAlertEvent =>
      ({
        userId: 'u1',
        alertId: 'a1',
        symbol,
        company: symbol,
        direction: 'buy',
        threshold,
        triggeredPrice,
        message: '',
        triggeredAt: new Date(),
      }) as StoredAlertEvent;

    const summary = summarizeDigest([event('VAML.NS', 439, 450), event('NVDA', 230.36, 240)]);
    expect(summary.lines[0]).toContain('₹439.00');
    expect(summary.lines[0]).toContain('₹450.00');
    expect(summary.lines[1]).toContain('$230.36');
  });
});
