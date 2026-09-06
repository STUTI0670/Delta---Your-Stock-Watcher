/**
 * A bare inline sparkline. No chart library: a single polyline over a
 * normalised series, sized by its container.
 */
export default function Sparkline({
  series,
  width = 84,
  height = 26,
  tone = 'flat',
}: {
  series: number[];
  width?: number;
  height?: number;
  tone?: 'up' | 'down' | 'flat';
}) {
  if (!series || series.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden="true" role="presentation" style={{ display: 'block' }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--line-strong)" strokeWidth={1.5} />
      </svg>
    );
  }

  const pad = 3;
  const usable = height - pad * 2;
  const step = width / (series.length - 1);
  // The series arrives normalised 0..1 with 1 as the high, so invert for SVG.
  const points = series.map((value, i) => `${(i * step).toFixed(2)},${(pad + (1 - value) * usable).toFixed(2)}`);

  const stroke = tone === 'up' ? 'var(--green)' : tone === 'down' ? 'var(--red)' : 'var(--ink-4)';

  return (
    <svg width={width} height={height} aria-hidden="true" role="presentation" style={{ display: 'block' }}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
