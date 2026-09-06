/** Loading state shaped like the briefing itself, so nothing jumps on arrival. */
export default function BriefSkeleton() {
  return (
    <div role="status" aria-label="Working out what changed">
      <div className="pt-10 pb-6 md:pt-14 md:pb-8">
        <div className="wp-skeleton h-8 w-[240px] md:h-9 md:w-[300px]" />
      </div>

      <div className="wp-brief">
        <div className="wp-brief-crown">
          <span className="wp-brief-pulse" aria-hidden="true" />
          <span className="wp-brief-crown-title">Since you last checked</span>
        </div>

        <div className="wp-brief-head">
          <div className="wp-skeleton h-9 w-[260px] md:h-10 md:w-[320px]" />
          <div className="wp-skeleton mt-4 h-4 w-[min(420px,85%)]" />
          <div className="mt-6 flex flex-wrap gap-2">
            {[130, 150, 120].map((w) => (
              <div key={w} className="wp-skeleton h-8 rounded-full" style={{ width: w }} />
            ))}
          </div>
        </div>

        {[0, 1, 2].map((i) => (
          <div key={i} className="wp-change">
            <span className="wp-change-mark" aria-hidden="true" />
            <span className="wp-change-body">
              <span className="wp-skeleton block h-4 w-[180px]" />
              <span className="wp-skeleton mt-3 block h-3.5 w-[min(300px,70%)]" />
            </span>
            <span className="wp-change-figs">
              <span className="wp-skeleton block h-6 w-[72px]" />
              <span className="wp-skeleton mt-2 block h-3.5 w-[56px]" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
