/**
 * Price history as a single filled area. No library, no toolbar, no indicators:
 * the chart gives the move context, it is not something to trade from.
 */
export default function PriceHistoryChart({
  series,
  tone = 'flat',
  height = 200,
}: {
  /** Normalised closes, oldest first. */
  series: number[];
  tone?: 'up' | 'down' | 'flat';
  height?: number;
}) {
  if (!series || series.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border py-16 text-[13.5px]"
        style={{ background: 'var(--paper)', borderColor: 'var(--line)', color: 'var(--ink-3)' }}
      >
        Price history is not available for this stock.
      </div>
    );
  }

  const width = 1000; // viewBox units; the SVG scales to its container.
  const pad = 10;
  const usable = height - pad * 2;
  const step = width / (series.length - 1);

  const points = series.map((value, i) => [i * step, pad + (1 - value) * usable] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} ${width},${height} 0,${height}`;

  const stroke = tone === 'up' ? 'var(--green)' : tone === 'down' ? 'var(--red)' : 'var(--blue)';
  const gradientId = `wp-area-${tone}`;

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ background: 'var(--paper)', borderColor: 'var(--line)' }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Price history over the last ${series.length} sessions`}
        style={{ display: 'block', width: '100%', height }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
