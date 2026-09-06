'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Three destinations. Search and profile live in the bar's right side. */
export const SECTIONS = [
  { href: '/', label: 'Home' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/alerts', label: 'Alerts' },
];

export function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
}

export default function NavLinks() {
  const isActive = useIsActive();

  return (
    <nav className="wp-nav" aria-label="Main">
      {SECTIONS.map((section) => (
        <Link key={section.href} href={section.href} className="wp-nav-link" data-active={isActive(section.href)}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
