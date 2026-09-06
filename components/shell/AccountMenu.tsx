'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { User } from 'lucide-react';
import { signOut } from '@/lib/actions/auth.actions';

export default function AccountMenu({
  user,
  variant = 'avatar',
}: {
  user: { name: string; email: string };
  variant?: 'avatar' | 'tab';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const initial = user.name?.trim()?.[0]?.toUpperCase() ?? '?';
  const isTab = variant === 'tab';

  return (
    <div className={isTab ? 'relative flex-1' : 'relative'} ref={ref}>
      {isTab ? (
        <button
          type="button"
          className="wp-tab w-full"
          data-active={open}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <User className="h-[18px] w-[18px]" strokeWidth={2} />
          Profile
        </button>
      ) : (
        <button
          type="button"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[13px] font-semibold text-white transition-transform hover:scale-105"
          style={{ background: 'linear-gradient(140deg, #2F5BEA 0%, #22C58A 130%)' }}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Profile"
        >
          {initial}
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute z-50 w-60 overflow-hidden rounded-2xl border ${
            isTab ? 'bottom-[68px] left-1/2 -translate-x-1/2' : 'right-0 top-12'
          }`}
          style={{
            background: 'var(--paper)',
            borderColor: 'var(--line)',
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3.5" style={{ borderColor: 'var(--line)' }}>
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
              style={{ background: 'linear-gradient(140deg, #2F5BEA 0%, #22C58A 130%)' }}
              aria-hidden="true"
            >
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                {user.name}
              </span>
              <span className="block truncate text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                {user.email}
              </span>
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="w-full cursor-pointer px-4 py-3 text-left text-[14px] font-medium transition-colors hover:bg-[var(--paper-sunk)]"
            style={{ color: 'var(--ink-2)' }}
            onClick={async () => {
              await signOut();
              router.push('/sign-in');
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
