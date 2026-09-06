import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import PriceHistoryChart from '@/components/stock/PriceHistoryChart';
import StockActions from '@/components/stock/StockActions';
import SectionHeading from '@/components/common/SectionHeading';
import { getSymbolBrief } from '@/lib/actions/dashboard.actions';
import { getFeedbackMap } from '@/lib/actions/feedback.actions';
import WhyThisMatters from '@/components/brief/WhyThisMatters';
import { getAlerts } from '@/lib/actions/alert.actions';
import { isWatched } from '@/lib/actions/watchlist.actions';
import { getSymbolNews } from '@/lib/actions/market.actions';
import { explainChange } from '@/lib/market/explain';
import { describeVolume } from '@/lib/market/volume';
import { describeQuoteStatus } from '@/lib/market/freshness';
import { formatMove, formatPrice, formatVolume, moveTone, verdictLabel } from '@/components/common/format';
import { currencyFor } from '@/lib/market/currency';

export const dynamic = 'force-dynamic';

/**
 * The stock page answers "what happened?" — in that order: the move, the three
 * signals behind it, why it mattered, then the underlying data. It explains the
 * stock rather than dumping statistics on it.
 */
export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase();

  const [change, watched, alerts, news, feedback] = await Promise.all([
    getSymbolBrief(symbol),
    isWatched(symbol),
    getAlerts(),
    getSymbolNews(symbol, 5).catch(() => []),
    getFeedbackMap(),
  ]);

  const company = change?.company ?? symbol;
  // Every price on this page — the quote, the comparison, the alert thresholds —
  // is the same stock, so they all share one currency.
  const currency = currencyFor(change?.currency, symbol);
  const symbolAlerts = alerts.filter((alert) => alert.symbol === symbol);
  const buyAlert = symbolAlerts.find((alert) => alert.direction === 'buy');
  const sellAlert = symbolAlerts.find((alert) => alert.direction === 'sell');

  const volumeNote = change?.volume ? describeVolume(change.volume) : null;
  const explanation = change
    ? explainChange({
        symbol,
        changePercent: change.changePercent,
        severity: change.severity,
        volumeRatio: change.volume?.ratio ?? null,
        volumeUnusual: Boolean(change.volume?.isUnusual),
        newsCount: change.newsCount,
        hasBaseline: change.hasBaseline,
        priceAvailable: change.currentPrice !== null,
      })
    : null;

  const quoteStatus = describeQuoteStatus(change?.updatedAt ?? null);

  const tone =
    change?.changePercent == null || change.changePercent === 0 ? 'flat' : change.changePercent > 0 ? 'up' : 'down';

  const showSinceCheck = Boolean(change && watched && change.hasBaseline);

  return (
    <article className="pt-8 md:pt-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-medium transition-colors hover:underline"
        style={{ color: 'var(--ink-3)' }}
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to your briefing
      </Link>

      {/* What it is, what it costs, and what it did since you last looked. */}
      <header className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-6">
        <div className="min-w-0">
          <h1 className="text-[32px] font-semibold tracking-[-0.03em] md:text-[40px]" style={{ color: 'var(--ink)' }}>
            {symbol}
          </h1>
          <p className="mt-0.5 text-[15px]" style={{ color: 'var(--ink-3)' }}>
            {company}
          </p>

          <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
            <span className="wp-num text-[38px] font-semibold leading-none tracking-[-0.035em]" style={{ color: 'var(--ink)' }}>
              {formatPrice(change?.currentPrice ?? null, currency)}
            </span>
            <span className={`wp-num text-[19px] font-semibold ${moveTone(change?.dayChangePercent ?? null)}`}>
              {formatMove(change?.dayChangePercent ?? null, 2)} today
            </span>
          </div>

          {/* A weekend price is not "delayed" — the exchange is simply shut. */}
          <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-4)' }}>
            {!change || change.currentPrice === null ? (
              'Market data is temporarily unavailable for this stock.'
            ) : (
              <>
                {quoteStatus.text}
                {change.error ? (
                  <span className="wp-flagtext" title={change.error}>
                    not live
                  </span>
                ) : (
                  quoteStatus.tone === 'delayed' && <span className="wp-flagtext">delayed</span>
                )}
              </>
            )}
          </p>
        </div>

        <StockActions
          symbol={symbol}
          company={company}
          currentPrice={change?.currentPrice ?? null}
          isWatched={watched}
          existingAlerts={symbolAlerts.map((alert) => ({
            direction: alert.direction,
            threshold: alert.threshold,
            isEnabled: alert.isEnabled,
          }))}
        />
      </header>

      {!watched && (
        <div className="wp-notice wp-notice-neutral mt-8">
          <span>
            {symbol} is not on your watchlist, so there is no checkpoint to compare against. Add it and we will start
            tracking what changes between your visits.
          </span>
        </div>
      )}

      {/* WHAT HAPPENED — the whole point of the page. */}
      {showSinceCheck && change && (
        <section className="mt-10">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="wp-section-title">Since your last check</h2>
            <span className="wp-pill" data-level={change.level}>
              {verdictLabel(change.level)}
            </span>
          </div>

          <div className="wp-stats">
            <div className="wp-stat">
              <p className="wp-stat-label">Price</p>
              <p className={`wp-stat-value ${moveTone(change.changePercent)}`}>{formatMove(change.changePercent)}</p>
              <p className="wp-stat-note">
                {formatPrice(change.previousPrice, currency)} → {formatPrice(change.currentPrice, currency)}
              </p>
            </div>

            <div className="wp-stat">
              <p className="wp-stat-label">Volume</p>
              <p className="wp-stat-value" style={change.volume?.isUnusual ? undefined : { color: 'var(--ink-3)' }}>
                {volumeNote ?? 'Normal'}
              </p>
              <p className="wp-stat-note">
                {change.volume?.latestVolume
                  ? `${formatVolume(change.volume.latestVolume)} shares traded`
                  : 'No volume data'}
              </p>
            </div>

            <div className="wp-stat">
              <p className="wp-stat-label">News</p>
              <p className="wp-stat-value" style={change.newsCount === 0 ? { color: 'var(--ink-3)' } : undefined}>
                {change.newsCount}
              </p>
              <p className="wp-stat-note">{change.newsCount === 1 ? 'story published' : 'stories published'}</p>
            </div>
          </div>
        </section>
      )}

      {/* WHY THIS MATTERS — the score itemised, with a way to tune it. */}
      {explanation && watched && (
        <section className="mt-10">
          <SectionHeading label="Why this matters" />
          <div className="wp-card wp-card-pad">
            <p className="max-w-[62ch] text-[17px] font-medium leading-relaxed" style={{ color: 'var(--ink)' }}>
              {explanation.headline}
            </p>
          </div>

          {change && (
            <div className="mt-4">
              <WhyThisMatters
                symbol={symbol}
                factors={change.whyFactors}
                unavailable={change.score.unavailableSignals}
                total={change.score.total}
                feedback={feedback}
              />
            </div>
          )}

          {change?.insight?.behavior.hasEnoughData && (
            <div className="wp-card wp-card-pad mt-4">
              <h3 className="wp-section-title">How {symbol} usually behaves</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                {change.insight.cadence.rationale}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="wp-cadence-pill" data-cadence={change.insight.cadence.cadence}>
                  {change.insight.cadence.label}
                </span>
                {change.insight.cadence.drivers.map((driver) => (
                  <span key={driver} className="wp-pill">
                    {driver}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-4)' }}>
                A suggestion about how often to look, based only on measured movement — not advice about buying or
                selling.
              </p>
            </div>
          )}
        </section>
      )}

      {/* THE DATA UNDERNEATH. */}
      <section className="mt-10">
        <SectionHeading label="Price history" />
        <PriceHistoryChart series={change?.sparkline ?? []} tone={tone} />
        {change?.historyError && (
          <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ink-4)' }}>
            {change.historyError}
          </p>
        )}
      </section>

      <section className="mt-10">
        <SectionHeading label="Your price alerts" href="/alerts" hrefLabel="Manage" />
        <div className="wp-card px-5 py-1 md:px-6">
          <div className="wp-threshold">
            <span className="wp-threshold-label">Buy when price reaches</span>
            <span className="wp-threshold-value">
              {buyAlert ? formatPrice(buyAlert.threshold, currency) : <span style={{ color: 'var(--ink-4)' }}>not set</span>}
            </span>
            {buyAlert && (
              <span className={`wp-pill ${buyAlert.isEnabled && buyAlert.isArmed ? 'wp-pill-up' : ''}`}>
                {!buyAlert.isEnabled ? 'Paused' : buyAlert.isArmed ? 'Active' : 'Triggered'}
              </span>
            )}
          </div>
          <div className="wp-threshold">
            <span className="wp-threshold-label">Sell when price reaches</span>
            <span className="wp-threshold-value">
              {sellAlert ? formatPrice(sellAlert.threshold, currency) : <span style={{ color: 'var(--ink-4)' }}>not set</span>}
            </span>
            {sellAlert && (
              <span className={`wp-pill ${sellAlert.isEnabled && sellAlert.isArmed ? 'wp-pill-up' : ''}`}>
                {!sellAlert.isEnabled ? 'Paused' : sellAlert.isArmed ? 'Active' : 'Triggered'}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading label="Relevant news" count={news.length} />
        {news.length === 0 ? (
          <div className="wp-notice wp-notice-neutral">
            <span>No recent stories found for {symbol}.</span>
          </div>
        ) : (
          <div className="wp-table">
            {news.slice(0, 5).map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="wp-tr group block"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-[15px] font-medium leading-snug group-hover:underline"
                    style={{ color: 'var(--ink)' }}
                  >
                    {article.headline}
                  </span>
                  <span className="mt-1 block text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {article.source} ·{' '}
                    {new Date(article.publishedAt * 1000).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-4)' }} aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}
