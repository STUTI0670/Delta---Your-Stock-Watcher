import { describe, expect, it } from 'vitest';
import { composeDailyBrief } from '@/lib/services/brief-email';
import type { AttentionReport, WatchlistChange } from '@/lib/services/attention.service';
import type { NewsArticle } from '@/lib/market/types';

const CHECKED_AT = new Date('2026-09-05T09:12:00Z');

function change(overrides: Partial<WatchlistChange> & { symbol: string }): WatchlistChange {
  return {
    company: overrides.symbol,
    previousPrice: 100,
    currentPrice: 107.6,
    currency: 'USD',
    changePercent: 7.6,
    dayChangePercent: 7.6,
    severity: 'large',
    isMeaningful: true,
    reasons: [],
    summary: 'Large movement since your last visit.',
    hasBaseline: true,
    stale: false,
    updatedAt: CHECKED_AT,
    error: null,
    newsCount: 0,
    level: 'critical',
    volume: null,
    sparkline: [],
    historyError: null,
    score: { total: 7, band: 'critical', factors: [], unavailableSignals: [] },
    whyFactors: [{ kind: 'price', points: 5, rawPoints: 5, text: 'Price moved +7.6%, a large move.' }],
    insight: null,
    thresholdCrossings: 0,
    ...overrides,
  } as WatchlistChange;
}

function report(overrides: Partial<AttentionReport> = {}): AttentionReport {
  const changes = overrides.changes ?? [];
  return {
    comparedTo: CHECKED_AT,
    isFirstCheck: false,
    changes,
    needsAttention: changes.filter((item) => item.level !== 'normal'),
    thresholdsReached: 0,
    dataUnavailable: false,
    degradedSymbols: [],
    newsUnavailable: false,
    insights: [],
    weights: { price: 1, volume: 1, event: 1, threshold: 1 },
    personalized: false,
    ...overrides,
  };
}

describe('composeDailyBrief — the email leads with the answer', () => {
  it('names the count and the movers in the headline', () => {
    const brief = composeDailyBrief({
      report: report({
        changes: [
          change({ symbol: 'NVDA', changePercent: 7.6 }),
          change({ symbol: 'TSLA', changePercent: -4.8, currentPrice: 95.2 }),
        ],
      }),
    });

    expect(brief.headline).toBe('2 meaningful changes — NVDA +7.6%, TSLA −4.8%');
    // Useful from the inbox list, unopened.
    expect(brief.subject).toBe('Delta: 2 meaningful changes — NVDA +7.6%, TSLA −4.8%');
  });

  it('uses the singular for a lone change', () => {
    const brief = composeDailyBrief({ report: report({ changes: [change({ symbol: 'NVDA' })] }) });
    expect(brief.headline).toBe('1 meaningful change — NVDA +7.6%');
  });

  it('rolls extra movers into "and N more" rather than listing everything', () => {
    const brief = composeDailyBrief({
      report: report({
        changes: ['A', 'B', 'C', 'D', 'E'].map((symbol) => change({ symbol })),
      }),
    });
    expect(brief.headline).toContain('and 2 more');
  });

  it('carries the dashboard’s own score reasons into the email', () => {
    const brief = composeDailyBrief({
      report: report({
        changes: [
          change({
            symbol: 'NVDA',
            whyFactors: [{ kind: 'volume', points: 3, rawPoints: 3, text: 'Volume is 3.2× its recent average.' }],
          }),
        ],
      }),
    });
    expect(brief.changesHtml).toContain('Volume is 3.2× its recent average.');
    expect(brief.changesHtml).toContain('Significant');
  });

  it('states the comparison window the figures are measured against', () => {
    const brief = composeDailyBrief({ report: report({ changes: [change({ symbol: 'NVDA' })] }) });
    expect(brief.standfirst).toContain('since you last checked');
  });
});

describe('composeDailyBrief — prices keep their own currency', () => {
  it('does not print a rupee price as dollars', () => {
    const brief = composeDailyBrief({
      report: report({
        changes: [change({ symbol: 'VAML.NS', currency: 'INR', currentPrice: 439 })],
      }),
    });
    expect(brief.changesHtml).toContain('₹439.00');
    expect(brief.changesHtml).not.toContain('$439');
    expect(brief.text).toContain('₹439.00');
  });

  it('renders a yen price without fractional units', () => {
    const brief = composeDailyBrief({
      report: report({ changes: [change({ symbol: '7809.T', currency: 'JPY', currentPrice: 1325 })] }),
    });
    expect(brief.changesHtml).toContain('¥1325');
  });
});

describe('composeDailyBrief — quiet, partial and first days', () => {
  it('reports a quiet day as a result rather than sending an empty page', () => {
    const brief = composeDailyBrief({
      report: report({
        changes: [change({ symbol: 'NVDA', level: 'normal' }), change({ symbol: 'MSFT', level: 'normal' })],
      }),
    });

    expect(brief.headline).toBe('Nothing needed your attention across 2 stocks');
    expect(brief.changesHtml).toContain('None moved far enough');
    expect(brief.worthSending).toBe(true);
  });

  it('names the stocks that stayed put alongside the ones that moved', () => {
    const brief = composeDailyBrief({
      report: report({
        changes: [change({ symbol: 'NVDA' }), change({ symbol: 'MSFT', level: 'normal' })],
      }),
    });
    expect(brief.changesHtml).toContain('Quiet: MSFT.');
  });

  it('says there is no baseline yet on a first briefing', () => {
    const brief = composeDailyBrief({
      report: report({ isFirstCheck: true, comparedTo: null, changes: [change({ symbol: 'NVDA', level: 'normal' })] }),
    });
    expect(brief.headline).toBe('Now tracking 1 stock');
    expect(brief.standfirst).toContain('no earlier check to measure against');
  });

  it('admits a total data outage instead of reporting a flat day', () => {
    const brief = composeDailyBrief({
      report: report({
        dataUnavailable: true,
        changes: [change({ symbol: 'NVDA', level: 'normal', currentPrice: null, changePercent: null })],
      }),
    });
    expect(brief.headline).toBe('We could not reach market data today');
    expect(brief.standfirst).toContain('baseline is untouched');
  });

  it('discloses symbols whose price could not be fetched', () => {
    const brief = composeDailyBrief({
      report: report({ changes: [change({ symbol: 'NVDA' })], degradedSymbols: ['MSFT'] }),
    });
    expect(brief.changesHtml).toContain('No price came back for MSFT');
  });

  it('mentions price alerts that fired', () => {
    const brief = composeDailyBrief({
      report: report({ changes: [change({ symbol: 'NVDA' })], thresholdsReached: 2 }),
    });
    expect(brief.changesHtml).toContain('2 of your price alerts were reached');
    expect(brief.text).toContain('2 price alerts were reached.');
  });

  it('stays silent for a user with no watchlist and no news', () => {
    expect(composeDailyBrief({ report: report() }).worthSending).toBe(false);
  });
});

describe('composeDailyBrief — news is attached, not the point', () => {
  const news: NewsArticle[] = [
    {
      id: '1',
      headline: 'Chipmaker raises guidance',
      source: 'Reuters',
      url: 'https://example.com/a',
      publishedAt: Math.floor(Date.parse('2026-09-05T12:00:00Z') / 1000),
    },
  ];

  it('puts the brief above the headlines', () => {
    const brief = composeDailyBrief({ report: report({ changes: [change({ symbol: 'NVDA' })] }), news });
    expect(brief.headline).toContain('meaningful change');
    expect(brief.newsHtml).toContain('Chipmaker raises guidance');
  });

  it('escapes markup in a headline rather than injecting it', () => {
    const brief = composeDailyBrief({
      report: report(),
      news: [{ ...news[0], headline: '<script>x</script>' }],
    });
    expect(brief.newsHtml).not.toContain('<script>');
    expect(brief.newsHtml).toContain('&lt;script&gt;');
  });

  it('omits the news block entirely when there is nothing to attach', () => {
    expect(composeDailyBrief({ report: report({ changes: [change({ symbol: 'NVDA' })] }) }).newsHtml).toBe('');
  });
});
