import Link from 'next/link';
import Logo from '@/components/brand/Logo';
import NavLinks from '@/components/shell/NavLinks';
import AccountMenu from '@/components/shell/AccountMenu';
import CommandSearch from '@/components/shell/CommandSearch';

export default function TopBar({ user }: { user: { name: string; email: string } }) {
  return (
    <header className="wp-topbar">
      <div className="wp-measure">
        <div className="wp-topbar-inner">
          <Link href="/" aria-label="Delta home">
            <Logo />
          </Link>

          <NavLinks />

          <div className="ml-auto flex items-center gap-2">
            <CommandSearch />
            <div className="hidden md:block">
              <AccountMenu user={user} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
