/**
 * The Delta mark.
 *
 * A delta — the mathematical symbol for change — drawn as a ribbon, with three
 * rising bars set inside it. Change is the entire product, so the logo is
 * literally that: what moved, and by how much.
 *
 * Blue resolves into green: brand into growth.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Delta"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="delta-mark" x1="10" y1="10" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B5BF5" />
          <stop offset="45%" stopColor="#2AA9C4" />
          <stop offset="100%" stopColor="#4FE08A" />
        </linearGradient>
      </defs>

      {/* The delta, drawn as a ribbon so the corners stay soft at any size. */}
      <path
        d="M32 11 L55 52 L9 52 Z"
        fill="none"
        stroke="url(#delta-mark)"
        strokeWidth="7.5"
        strokeLinejoin="round"
      />

      {/* Three rising bars: the change itself. */}
      <rect x="19.5" y="40" width="6" height="8" rx="3" fill="url(#delta-mark)" />
      <rect x="29" y="33.5" width="6" height="14.5" rx="3" fill="url(#delta-mark)" />
      <rect x="38.5" y="27" width="6" height="21" rx="3" fill="url(#delta-mark)" />
    </svg>
  );
}

export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="wp-brand">
      <LogoMark size={size} />
      <span className="wp-brand-name">Delta</span>
    </span>
  );
}
