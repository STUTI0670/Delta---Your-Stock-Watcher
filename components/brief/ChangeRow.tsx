import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { describeVolume } from '@/lib/market/volume';
import { formatMove, formatPrice, moveTone, verdictLabel } from '@/components/common/format';
import type { DashboardChange } from '@/lib/actions/dashboard.types';

/**
 * One line of the briefing: a stock, what it did, and whether that mattered.
 *
 * Priority is carried by the left mark and the verdict pill, never by making
 * the row a coloured card — colour here belongs to the market, not to us.
 */
export default function ChangeRow({ change }: { change: DashboardChange }) {
  const volumeNote = change.volume?.isUnusual ? describeVolume(change.volume) : null;

  return (
    <Link href={`/stocks/${change.symbol}`} className="wp-change" data-level={change.level}>
      <span className="wp-change-mark" aria-hidden="true" />

      <span className="wp-change-body">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="wp-change-symbol">{change.symbol}</span>
          <span className="wp-change-company">{change.company}</span>
          <span className="wp-pill" data-level={change.level}>
            {verdictLabel(change.level)}
          </span>
          {change.score.total > 0 && (
            <span
              className="wp-score"
              data-band={change.score.band}
              title={`Attention score ${change.score.total} — ${change.whyFactors.length} ${
                change.whyFactors.length === 1 ? 'signal' : 'signals'
              } contributed`}
            >
              <span className="wp-score-num">{change.score.total}</span>
            </span>
          )}
        </span>

        <span className="wp-change-note block">{change.whyFactors[0]?.text ?? change.summary}</span>

        {(volumeNote || change.newsCount > 0) && (
          <span className="wp-change-signals">
            {volumeNote && (
              <span>
                Volume <strong className="wp-num font-semibold text-[var(--ink-2)]">{volumeNote}</strong>
              </span>
            )}
            {change.newsCount > 0 && (
              <span>
                <strong className="wp-num font-semibold text-[var(--ink-2)]">{change.newsCount}</strong>{' '}
                {change.newsCount === 1 ? 'related story' : 'related stories'}
              </span>
            )}
          </span>
        )}
      </span>

      <span className="wp-change-figs">
        <span className={`wp-change-move ${moveTone(change.changePercent)}`}>{formatMove(change.changePercent)}</span>
        <span className="wp-change-price">{formatPrice(change.currentPrice, change.currency)}</span>
      </span>

      <ChevronRight className="mt-1.5 hidden h-4 w-4 shrink-0 text-[var(--ink-4)] sm:block" aria-hidden="true" />
    </Link>
  );
}
