'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bell, X } from 'lucide-react';
import Sparkline from '@/components/common/Sparkline';
import AlertComposer from '@/components/alerts/AlertComposer';
import { removeFromWatchlist } from '@/lib/actions/watchlist.actions';
import { describeQuoteStatus } from '@/lib/market/freshness';
import { formatMove, formatPrice, moveTone, verdictLabel } from '@/components/common/format';
import type { DashboardChange } from '@/lib/actions/dashboard.types';

/**
 * The watchlist proper — a list/table hybrid.
 *
 * Deliberately quieter than the briefing: every row carries the same weight,
 * there are no coloured cards, and the only judgement on the row is the single
 * word in the "since last check" column.
 */
export default function WatchlistRows({ changes, compact = false }: { changes: DashboardChange[]; compact?: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [alertFor, setAlertFor] = useState<DashboardChange | null>(null);

  const remove = (change: DashboardChange) => {
    setBusy(change.symbol);
    startTransition(async () => {
      const outcome = await removeFromWatchlist(change.symbol);
      setBusy(null);
      if (outcome.ok) {
        toast.success(`${change.symbol} removed from your watchlist`);
        router.refresh();
      } else {
        toast.error(outcome.error ?? 'Could not remove that stock.');
      }
    });
  };

  // The newest quote in the table speaks for it; they all come from one fetch.
  const newest = changes.reduce<string | null>((best, c) => {
    if (!c.updatedAt) return best;
    return !best || new Date(c.updatedAt) > new Date(best) ? c.updatedAt : best;
  }, null);
  const freshest = newest ? describeQuoteStatus(newest) : null;

  return (
    <>
      <div className="wp-table">
        <div className="wp-thead" aria-hidden="true">
          <span className="wp-td-id wp-th">Stock</span>
          {!compact && <span className="wp-td-spark" />}
          <span className="wp-td-price wp-th">Price</span>
          <span className="wp-td-move wp-th">Today</span>
          <span className="wp-td-since wp-th">Since last check</span>
          <span className="wp-td-actions" />
        </div>

        {changes.map((change) => (
          <div key={change.symbol} className="wp-tr">
            <Link href={`/stocks/${change.symbol}`} className="wp-td-id">
              <span className="wp-td-symbol">{change.symbol}</span>
              <span className="wp-td-company">{change.company}</span>
            </Link>

            {!compact && (
              <span className="wp-td-spark">
                <Sparkline
                  series={change.sparkline}
                  tone={
                    change.dayChangePercent === null || change.dayChangePercent === 0
                      ? 'flat'
                      : change.dayChangePercent > 0
                        ? 'up'
                        : 'down'
                  }
                />
              </span>
            )}

            <span className="wp-td-price">
              {formatPrice(change.currentPrice, change.currency)}
              {change.currentPrice === null && (
                <span className="wp-flagtext" title={change.error ?? undefined}>
                  n/a
                </span>
              )}
            </span>

            <span className={`wp-td-move ${moveTone(change.dayChangePercent)}`}>
              {formatMove(change.dayChangePercent, 2)}
            </span>

            {/* The product's own verdict, next to the raw figure it came from. */}
            <span className="wp-td-since items-center gap-2">
              <span className={`wp-num text-[13px] ${moveTone(change.changePercent)}`}>
                {change.changePercent !== null ? formatMove(change.changePercent, 1) : ''}
              </span>
              <span className="wp-pill" data-level={change.level}>
                {change.hasBaseline ? verdictLabel(change.level) : 'New'}
              </span>
            </span>

            <span className="wp-td-actions">
              <button
                type="button"
                className="wp-icon-btn"
                title={`Set a price alert for ${change.symbol}`}
                aria-label={`Set a price alert for ${change.symbol}`}
                onClick={() => setAlertFor(change)}
              >
                <Bell className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="wp-icon-btn"
                title={`Stop watching ${change.symbol}`}
                aria-label={`Stop watching ${change.symbol}`}
                disabled={busy === change.symbol}
                onClick={() => remove(change)}
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* One honest line about the whole table, rather than a badge per row. */}
      {!compact && freshest && (
        <p className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-4)' }}>
          {freshest.tone === 'closed'
            ? `Markets are closed. ${freshest.text}.`
            : freshest.tone === 'delayed'
              ? `Prices may be delayed. ${freshest.text}.`
              : `${freshest.text}.`}
        </p>
      )}

      {alertFor && (
        <AlertComposer
          open
          onClose={() => setAlertFor(null)}
          symbol={alertFor.symbol}
          company={alertFor.company}
          currentPrice={alertFor.currentPrice}
        />
      )}
    </>
  );
}
