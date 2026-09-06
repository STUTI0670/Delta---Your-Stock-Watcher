import { ListChecks } from 'lucide-react';
import WatchlistRows from '@/components/watchlist/WatchlistRows';
import CadenceList from '@/components/watchlist/CadenceList';
import SectionHeading from '@/components/common/SectionHeading';
import CommandSearch from '@/components/shell/CommandSearch';
import { getMarketBrief } from '@/lib/actions/dashboard.actions';
import { describeElapsed } from '@/lib/market/freshness';

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  const brief = await getMarketBrief();
  const total = brief?.changes.length ?? 0;
  const flagged = brief?.needsAttention.length ?? 0;
  const elapsed = describeElapsed(brief?.comparedTo ?? null);

  return (
    <section className="pt-10 md:pt-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="wp-page-title">Watchlist</h1>
          <p className="wp-page-sub">
            {total === 0
              ? 'Nothing under watch yet.'
              : brief?.isFirstCheck || !elapsed
                ? `${total} ${total === 1 ? 'stock' : 'stocks'}. We have saved where they stand right now.`
                : `${total} ${total === 1 ? 'stock' : 'stocks'} · ${flagged} changed meaningfully since your last check ${
                    elapsed.unit === 'ago' ? elapsed.value : `${elapsed.value} ${elapsed.unit}`
                  } ago.`}
          </p>
        </div>
        {total > 0 && <CommandSearch variant="primary" />}
      </div>

      <div className="mt-8">
        {total === 0 ? (
          <div className="wp-empty">
            <span className="wp-empty-art">
              <ListChecks className="h-6 w-6" />
            </span>
            <h2 className="wp-empty-title">Nothing under watch yet</h2>
            <p className="wp-empty-body">
              Add a few stocks and we will tell you exactly what changed every time you come back.
            </p>
            <div className="wp-empty-action">
              <CommandSearch variant="primary" />
            </div>
          </div>
        ) : (
          <WatchlistRows changes={brief!.changes} />
        )}
      </div>

      {/* How often each stock is worth checking — measured, never advice. */}
      {total > 0 && (brief?.insights.length ?? 0) > 0 && (
        <div className="mt-12">
          <SectionHeading label="How closely to watch" />
          <div className="wp-card wp-card-pad mt-3">
            <CadenceList insights={brief!.insights} />
          </div>
        </div>
      )}
    </section>
  );
}
