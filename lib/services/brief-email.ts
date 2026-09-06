/**
 * The daily briefing email.
 *
 * Delta answers one question — "what meaningfully changed since I last
 * checked?" — and this is that answer, delivered to someone who is not in the
 * app. It is built from the same `AttentionReport` the dashboard renders, so
 * the email can never disagree with what the user sees when they open it: the
 * same scores, the same reasons, the same figures.
 *
 * News is kept, but demoted. Headlines are context for a change, not the
 * briefing itself; a list of stories that never mentions the reader's own
 * holdings is a newsletter, and this product does not send newsletters.
 *
 * Pure: no network, no database, no mail transport — so every sentence here is
 * testable without sending anything.
 */

import { describeVolume } from '@/lib/market/volume';
import { formatMoney } from '@/lib/market/currency';
import type { NewsArticle } from '@/lib/market/types';
import type { AttentionReport, WatchlistChange } from '@/lib/services/attention.service';

/** Attention items listed in full before the rest are rolled into one line. */
const MAX_DETAILED_ROWS = 6;

/** Symbols named in the headline before it turns into "and N more". */
const MAX_HEADLINE_SYMBOLS = 3;

const MAX_NEWS_ITEMS = 5;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A signed percentage, with a move that rounds to zero losing its sign. */
function signedPercent(value: number | null, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) < 0.5 / 10 ** digits ? 0 : value;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(digits)}%`;
}

function verdict(level: WatchlistChange['level']): string {
  if (level === 'critical') return 'Significant';
  if (level === 'watch') return 'Worth a look';
  return 'Quiet';
}

/** Email clients cannot be trusted with CSS variables, so tone is inline. */
function moveColor(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return '#4a5a72';
  return value > 0 ? '#0f8a5f' : '#d1453b';
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function whenLabel(date: Date): string {
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface DailyBrief {
  /** Subject line. Carries the answer, so it is useful unopened. */
  subject: string;
  /** The one sentence that leads the email. */
  headline: string;
  /** The comparison window, or why there isn't one. */
  standfirst: string;
  /** Rendered attention rows, or the "all quiet" note. */
  changesHtml: string;
  /** Rendered news list. Empty string when there is nothing to attach. */
  newsHtml: string;
  /** Plain-text alternative for clients that will not render HTML. */
  text: string;
  /**
   * Whether this is worth putting in someone's inbox. False for a user with an
   * empty watchlist and no news — silence beats an empty page.
   */
  worthSending: boolean;
}

/** "NVDA +7.6%, TSLA −4.8%" — the movers, named in the headline itself. */
function headlineMovers(changes: WatchlistChange[]): string {
  const named = changes
    .slice(0, MAX_HEADLINE_SYMBOLS)
    .map((change) => `${change.symbol} ${signedPercent(change.changePercent)}`)
    .join(', ');

  const rest = changes.length - MAX_HEADLINE_SYMBOLS;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

interface Lead {
  headline: string;
  standfirst: string;
}

/**
 * The lead depends on what we could actually establish, in order of honesty:
 * a broken data feed first, then a missing baseline, then the real answer.
 */
function buildLead(report: AttentionReport, watchedCount: number): Lead {
  if (watchedCount === 0) {
    return {
      headline: 'Your watchlist is empty',
      standfirst: 'Add a stock and tomorrow’s briefing will tell you what moved.',
    };
  }

  if (report.dataUnavailable) {
    return {
      headline: 'We could not reach market data today',
      standfirst:
        'No prices came back for your watchlist, so there is nothing to compare. Your baseline is untouched — tomorrow’s briefing will pick up where this one left off.',
    };
  }

  if (report.isFirstCheck) {
    return {
      headline: `Now tracking ${watchedCount} ${plural(watchedCount, 'stock', 'stocks')}`,
      standfirst:
        'This is your first briefing, so there is no earlier check to measure against yet. We have recorded where your stocks stand and will report what changes from here.',
    };
  }

  const since = report.comparedTo
    ? `since you last checked, on ${whenLabel(report.comparedTo)}`
    : 'since your last check';

  if (report.needsAttention.length === 0) {
    return {
      headline: `Nothing needed your attention across ${watchedCount} ${plural(watchedCount, 'stock', 'stocks')}`,
      standfirst: `Nothing crossed the thresholds Delta watches ${since}.`,
    };
  }

  const count = report.needsAttention.length;
  return {
    headline: `${count} meaningful ${plural(count, 'change', 'changes')} — ${headlineMovers(report.needsAttention)}`,
    standfirst: `Measured ${since}.`,
  };
}

/** One attention row: what it is, what it did, and why that was surfaced. */
function renderChangeRow(change: WatchlistChange): string {
  const volumeNote = change.volume?.isUnusual ? describeVolume(change.volume) : null;
  const reason = change.whyFactors[0]?.text ?? change.summary;

  const signals: string[] = [];
  if (volumeNote) signals.push(`Volume ${volumeNote}`);
  if (change.newsCount > 0) {
    signals.push(`${change.newsCount} related ${plural(change.newsCount, 'story', 'stories')}`);
  }

  const signalLine =
    signals.length > 0
      ? `<div style="color:#7c8ba3;font-size:12.5px;padding-top:5px;">${escapeHtml(signals.join(' · '))}</div>`
      : '';

  return `<tr>
    <td style="padding:16px 0;border-bottom:1px solid #e6ebf3;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="color:#0d1b2f;font-size:15px;font-weight:700;letter-spacing:-0.2px;">${escapeHtml(change.symbol)}
              <span style="color:#7c8ba3;font-size:13px;font-weight:500;">${escapeHtml(change.company)}</span>
            </div>
            <div style="color:#4a5a72;font-size:13.5px;line-height:20px;padding-top:5px;">${escapeHtml(reason)}</div>
            ${signalLine}
          </td>
          <td align="right" style="vertical-align:top;white-space:nowrap;padding-left:16px;">
            <div style="color:${moveColor(change.changePercent)};font-size:16px;font-weight:700;">${signedPercent(change.changePercent)}</div>
            <div style="color:#0d1b2f;font-size:13.5px;padding-top:4px;">${escapeHtml(formatMoney(change.currentPrice, change.currency))}</div>
            <div style="color:#7c8ba3;font-size:11.5px;padding-top:4px;">${escapeHtml(verdict(change.level))}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function renderNote(text: string): string {
  return `<tr><td style="padding:14px 0;color:#4a5a72;font-size:14px;line-height:22px;">${escapeHtml(text)}</td></tr>`;
}

function renderChanges(report: AttentionReport, watchedCount: number): string {
  const rows: string[] = [];

  if (report.needsAttention.length > 0) {
    for (const change of report.needsAttention.slice(0, MAX_DETAILED_ROWS)) rows.push(renderChangeRow(change));

    const hidden = report.needsAttention.length - MAX_DETAILED_ROWS;
    if (hidden > 0) {
      rows.push(renderNote(`${hidden} more ${plural(hidden, 'stock', 'stocks')} also moved. Open Delta to see them.`));
    }

    // Name what stayed put too, so "quiet" is a reported result and not an omission.
    const flagged = new Set(report.needsAttention.map((change) => change.symbol));
    const quiet = report.changes.filter((change) => !flagged.has(change.symbol)).map((change) => change.symbol);
    if (quiet.length > 0) rows.push(renderNote(`Quiet: ${quiet.join(', ')}.`));
  } else if (watchedCount > 0 && !report.dataUnavailable && !report.isFirstCheck) {
    rows.push(
      renderNote(
        `We checked all ${watchedCount} ${plural(watchedCount, 'stock', 'stocks')} on your watchlist. None moved far enough, traded unusually enough, or drew enough coverage to be worth your time today.`
      )
    );
  }

  if (report.thresholdsReached > 0) {
    rows.push(
      renderNote(
        `${report.thresholdsReached} of your price ${plural(report.thresholdsReached, 'alert was', 'alerts were')} reached since your last check.`
      )
    );
  }

  // Degradation is disclosed rather than hidden behind a confident-looking page.
  if (!report.dataUnavailable && report.degradedSymbols.length > 0) {
    rows.push(
      renderNote(
        `No price came back for ${report.degradedSymbols.join(', ')}, so ${plural(report.degradedSymbols.length, 'it is', 'they are')} not included above.`
      )
    );
  }

  if (rows.length === 0) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`;
}

function renderNews(articles: NewsArticle[]): string {
  if (articles.length === 0) return '';

  const items = articles
    .slice(0, MAX_NEWS_ITEMS)
    .map((article) => {
      const when = new Date(article.publishedAt * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return `<div style="padding:12px 0;border-bottom:1px solid #e6ebf3;">
        <a href="${escapeHtml(article.url)}" style="color:#0d1b2f;font-size:14.5px;font-weight:600;text-decoration:none;line-height:1.4;">${escapeHtml(article.headline)}</a>
        <div style="color:#7c8ba3;font-size:12px;padding-top:5px;">${escapeHtml(article.source)} · ${when}</div>
      </div>`;
    })
    .join('');

  return `<div style="padding-top:8px;">
    <div style="color:#7c8ba3;font-size:11.5px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;padding-bottom:6px;">In the news</div>
    ${items}
  </div>`;
}

function buildText(lead: Lead, report: AttentionReport): string {
  const lines = [lead.headline, '', lead.standfirst];

  if (report.needsAttention.length > 0) {
    lines.push('');
    for (const change of report.needsAttention.slice(0, MAX_DETAILED_ROWS)) {
      const price = formatMoney(change.currentPrice, change.currency);
      const reason = change.whyFactors[0]?.text ?? change.summary;
      lines.push(`${change.symbol} ${signedPercent(change.changePercent)} ${price} — ${reason}`);
    }
  }

  if (report.thresholdsReached > 0) {
    lines.push(
      '',
      `${report.thresholdsReached} price ${plural(report.thresholdsReached, 'alert was', 'alerts were')} reached.`
    );
  }

  return lines.join('\n');
}

export interface ComposeBriefInput {
  report: AttentionReport;
  /** Stories to attach under the brief. Optional — the brief stands alone. */
  news?: NewsArticle[];
}

/** Turn a report into the briefing that gets mailed. */
export function composeDailyBrief({ report, news = [] }: ComposeBriefInput): DailyBrief {
  const watchedCount = report.changes.length;
  const lead = buildLead(report, watchedCount);

  return {
    // Colon, not a dash: the headline already contains one.
    subject: `Delta: ${lead.headline}`,
    headline: lead.headline,
    standfirst: lead.standfirst,
    changesHtml: renderChanges(report, watchedCount),
    newsHtml: renderNews(news),
    text: buildText(lead, report),
    // An empty watchlist with no news gives us nothing worth an email.
    worthSending: watchedCount > 0 || news.length > 0,
  };
}
