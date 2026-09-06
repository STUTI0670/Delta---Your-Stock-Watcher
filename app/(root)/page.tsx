import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, LineChart } from 'lucide-react';
import SinceYouLastChecked from '@/components/brief/SinceYouLastChecked';
import WatchlistRows from '@/components/watchlist/WatchlistRows';
import BriefSkeleton from '@/components/common/BriefSkeleton';
import CommandSearch from '@/components/shell/CommandSearch';
import { getMarketBrief } from '@/lib/actions/dashboard.actions';
import { getAlerts } from '@/lib/actions/alert.actions';
import { getSessionUser } from '@/lib/actions/session';
import { formatPrice } from '@/components/common/format';
import { currencyForSymbol } from '@/lib/market/currency';

// The checkpoint advances as a side effect of rendering, so this page must
// never be cached or statically rendered.
export const dynamic = 'force-dynamic';

/** "Good morning" / "Good afternoon" / "Good evening" in the viewer's day. */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A personal market briefing. One question, answered before anything else. */
async function Brief() {
  const [brief, alerts, user] = await Promise.all([getMarketBrief(), getAlerts(), getSessionUser()]);
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? 'there';

  if (!brief) {
    return (
      <section className="pt-10">
        <div className="wp-empty">
          <h1 className="wp-empty-title">We could not load your briefing.</h1>
          <p className="wp-empty-body">Refresh the page and we will try again.</p>
        </div>
      </section>
    );
  }

  // A brand new user gets an invitation, not an empty table.
  if (brief.changes.length === 0) {
    return (
      <section className="pt-10 md:pt-14">
        <p className="wp-label">{greeting(new Date())}, {firstName}</p>
        <h1 className="wp-page-title mt-3">Let us watch the market for you.</h1>
        <p className="wp-page-sub">
          Add the stocks you care about. Delta remembers exactly where they stood, and every time you come back it
          tells you only what changed since.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { title: 'Add a few stocks', body: 'Search by symbol or company name.' },
            { title: 'We save the moment', body: 'Prices are checkpointed the second you look.' },
            { title: 'Come back later', body: 'We report only the meaningful changes.' },
          ].map((step, i) => (
            <div key={step.title} className="wp-card wp-card-pad">
              <span
                className="wp-num flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold"
                style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}
              >
                {i + 1}
              </span>
              <p className="mt-4 text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                {step.title}
              </p>
              <p className="mt-1 text-[13.5px]" style={{ color: 'var(--ink-3)' }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <CommandSearch variant="primary" />
        </div>
      </section>
    );
  }

  const activeAlerts = alerts.filter((alert) => alert.isEnabled);
  const degraded = brief.degradedSymbols.length;

  return (
    <>
      {/* Greeting, then the briefing. Nothing above it, nothing beside it. */}
      <header className="pt-10 pb-6 md:pt-14 md:pb-8">
        <h1 className="wp-page-title">
          {greeting(new Date())}, {firstName}
        </h1>
      </header>

      <SinceYouLastChecked brief={brief} />

      {degraded > 0 && !brief.dataUnavailable && (
        <p className="wp-notice mt-4">
          <span>
            We could not get a live price for {brief.degradedSymbols.slice(0, 4).join(', ')}
            {degraded > 4 ? ` and ${degraded - 4} more` : ''}. Those are shown with their last known figures.
          </span>
        </p>
      )}

      {/* Secondary: the raw watchlist, deliberately quieter. */}
      <section className="mt-14">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="wp-section-title">Your watchlist</h2>
          <Link
            href="/watchlist"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold hover:underline"
            style={{ color: 'var(--blue)' }}
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <WatchlistRows changes={brief.changes.slice(0, 6)} compact />
      </section>

      {/* Tertiary: the thresholds the user asked to be told about. */}
      <section className="mt-12">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="wp-section-title">Price alerts</h2>
          <Link
            href="/alerts"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold hover:underline"
            style={{ color: 'var(--blue)' }}
          >
            Manage <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {activeAlerts.length === 0 ? (
          <div className="wp-card wp-card-pad flex flex-wrap items-center gap-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}
            >
              <Bell className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                No price alerts yet
              </span>
              <span className="block text-[13.5px]" style={{ color: 'var(--ink-3)' }}>
                Name a buy or sell price on any stock and we will watch it for you.
              </span>
            </span>
          </div>
        ) : (
          <div className="wp-table">
            {activeAlerts.slice(0, 4).map((alert) => (
              <Link key={alert.id} href={`/stocks/${alert.symbol}`} className="wp-alert-row">
                <span className="wp-alert-icon" data-direction={alert.direction}>
                  <LineChart className="h-4 w-4" />
                </span>
                <span className="wp-alert-id">
                  <span className="wp-alert-symbol">{alert.symbol}</span>
                  <span className="wp-alert-rule">
                    {alert.direction === 'buy' ? 'Buy at or below' : 'Sell at or above'}{' '}
                    {formatPrice(alert.threshold, currencyForSymbol(alert.symbol))}
                  </span>
                </span>
                <span className={`wp-pill ${alert.isArmed ? 'wp-pill-up' : ''}`}>
                  {alert.isArmed ? 'Active' : 'Triggered'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<BriefSkeleton />}>
      <Brief />
    </Suspense>
  );
}
