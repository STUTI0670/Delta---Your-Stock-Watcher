import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/** A title, an optional count, and an optional way out. No card chrome. */
export default function SectionHeading({
  label,
  count,
  href,
  hrefLabel,
}: {
  label: string;
  count?: number;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="wp-section-title">
        {label}
        {typeof count === 'number' && (
          <span className="wp-num ml-2 text-[14px] font-medium" style={{ color: 'var(--ink-4)' }}>
            {count}
          </span>
        )}
      </h2>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold hover:underline"
          style={{ color: 'var(--blue)' }}
        >
          {hrefLabel ?? 'View all'} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
