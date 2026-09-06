import Link from 'next/link';
import type { SymbolInsight } from '@/lib/actions/dashboard.types';

/**
 * How closely each stock is worth watching.
 *
 * This is a statement about the user's attention, not about their money: it is
 * derived purely from how much each stock has been moving and how often it has
 * tripped their own alerts. It never says anything about buying or selling.
 */
export default function CadenceList({ insights }: { insights: SymbolInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div>
      {insights.map((insight) => (
        <div key={insight.symbol} className="wp-cadence">
          <span className="wp-cadence-id">
            <Link href={`/stocks/${insight.symbol}`} className="wp-cadence-symbol hover:underline">
              {insight.symbol}
            </Link>
            <span className="wp-cadence-note">{insight.cadence.rationale}</span>
          </span>

          <span className="wp-cadence-stat" title="Average absolute daily movement">
            {insight.behavior.averageAbsDailyMovePct === null
              ? '—'
              : `${insight.behavior.averageAbsDailyMovePct.toFixed(1)}%`}
          </span>

          <span className="wp-cadence-pill" data-cadence={insight.cadence.cadence}>
            {insight.cadence.label}
          </span>
        </div>
      ))}

      <p className="mt-4 text-[12.5px]" style={{ color: 'var(--ink-4)' }}>
        Based only on how much each stock has moved recently and how often it reached your own price alerts. This is
        about how often to look — not advice about buying or selling.
      </p>
    </div>
  );
}
