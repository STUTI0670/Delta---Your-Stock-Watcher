'use client';

import Link from 'next/link';
import { Home, ListChecks, Bell } from 'lucide-react';
import CommandSearch from '@/components/shell/CommandSearch';
import AccountMenu from '@/components/shell/AccountMenu';
import { useIsActive } from '@/components/shell/NavLinks';

const TABS = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/watchlist', label: 'Watchlist', Icon: ListChecks },
  { href: '/alerts', label: 'Alerts', Icon: Bell },
];

/** The whole product in one thumb reach: home, watchlist, alerts, search, profile. */
export default function MobileTabs({ user }: { user: { name: string; email: string } }) {
  const isActive = useIsActive();

  return (
    <nav className="wp-tabbar" aria-label="Main">
      {TABS.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className="wp-tab" data-active={isActive(href)}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          {label}
        </Link>
      ))}
      <CommandSearch variant="tab" />
      <AccountMenu user={user} variant="tab" />
    </nav>
  );
}
