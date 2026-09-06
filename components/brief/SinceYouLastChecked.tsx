import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import ChangeRow from '@/components/brief/ChangeRow';
import { describeElapsed } from '@/lib/market/freshness';
import type { DashboardChange, MarketBrief } from '@/lib/actions/dashboard.types';

/**
 * THE signature component.
 *
 * Everything the product is, in one object: a crowned sheet that says how long
 * you were away, how much of it mattered, and then the handful of stocks that
 * account for it. Nothing else on any screen is allowed to compete with this.
 */
export default function SinceYouLastChecked({ brief }: { brief: MarketBrief }) {
  const elapsed = describeElapsed(brief.comparedTo);
  const elapsedText =
    brief.isFirstCheck || !elapsed
      ? 'Starting now'
      : elapsed.unit === 'now'
        ? 'Moments ago'
        : `${elapsed.value} ${elapsed.unit === 'ago' ? 'ago' : `${elapsed.unit} ago`}`;

  // The brief always shows a few stocks, so the calm ones are visibly calm
  // rather than simply absent. Attention items first, then the quietest fill.
  const quiet = brief.changes.filter((c) => !brief.needsAttention.some((n) => n.symbol === c.symbol));
  const shown: DashboardChange[] = [...brief.needsAttention, ...quiet].slice(0, Math.max(3, brief.needsAttention.length));

  const count = brief.meaningfulCount;
  const headline = brief.isFirstCheck
    ? 'Your starting point is saved'
    : brief.dataUnavailable
      ? 'Nothing to compare yet'
      : count === 0
        ? 'Nothing meaningful changed'
        : `${count} meaningful ${count === 1 ? 'change' : 'changes'}`;

  const note = brief.isFirstCheck
    ? 'This visit is the baseline. Come back later and this is where we will tell you exactly what moved while you were away.'
    : brief.dataUnavailable
      ? 'Market data is temporarily unavailable, so nothing could be compared. Your last checkpoint is safe and this fills in as soon as prices return.'
      : count === 0
        ? 'Your watchlist stayed quiet while you were away. Nothing here needs you today.'
        : 'These are the only things on your watchlist that did something worth knowing about.';

  const facets = [
    {
      label: brief.majorMoveCount === 1 ? 'major movement' : 'major movements',
      value: brief.majorMoveCount,
    },
    {
      label: brief.unusualVolumeCount === 1 ? 'unusual activity' : 'unusual activity',
      value: brief.unusualVolumeCount,
    },
    {
      label: brief.thresholdsReached === 1 ? 'alert triggered' : 'alerts triggered',
      value: brief.thresholdsReached,
    },
    ...(brief.newsUnavailable
      ? []
      : [{ label: brief.eventCount === 1 ? 'relevant event' : 'relevant events', value: brief.eventCount }]),
  ];

  return (
    <section className="wp-brief" aria-label="Since you last checked">
      <div className="wp-brief-crown">
        <span className="wp-brief-pulse" aria-hidden="true" />
        <span className="wp-brief-crown-title">Since you last checked</span>
        <span className="wp-brief-crown-time">{elapsedText}</span>
      </div>

      <div className="wp-brief-head">
        <h2 className="wp-brief-count">{headline}</h2>
        <p className="wp-brief-note">{note}</p>

        {!brief.isFirstCheck && !brief.dataUnavailable && (
          <div className="wp-facets">
            {facets.map((facet) => (
              <span key={facet.label} className="wp-facet" data-on={facet.value > 0}>
                <span className="wp-facet-dot" aria-hidden="true" />
                <span className="wp-facet-num">{facet.value}</span> {facet.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {!brief.dataUnavailable && shown.map((change) => <ChangeRow key={change.symbol} change={change} />)}

      <div className="wp-brief-foot">
        <span className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
          Watching {brief.changes.length} {brief.changes.length === 1 ? 'stock' : 'stocks'}
        </span>
        <Link
          href="/watchlist"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold hover:underline"
          style={{ color: 'var(--blue)' }}
        >
          Full watchlist <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
