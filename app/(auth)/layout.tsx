import Link from 'next/link';
import Logo from '@/components/brand/Logo';
import { auth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect('/');

  return (
    <main className="auth-layout">
      <section className="auth-left-section scrollbar-hide-default">
        <Link href="/" className="auth-logo">
          <Logo size={32} />
        </Link>

        <div className="flex w-full max-w-[400px] flex-1 flex-col justify-center pb-8">{children}</div>
      </section>

      <section className="auth-right-section">
        <div>
          <Logo size={34} />
          <p className="auth-quote mt-12">I was away. Tell me what changed.</p>
          <p className="auth-quote-note">
            Delta remembers exactly where your watchlist stood the last time you looked, then reports only what
            moved since — so you never scan a table of tickers again.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-4">
          {[
            { value: '3%', label: 'flags a meaningful move' },
            { value: '2×', label: 'flags unusual volume' },
            { value: '1', label: 'alert per crossing' },
          ].map((item) => (
            <div key={item.label}>
              <dd
                className="wp-num text-[26px] font-semibold leading-none tracking-[-0.03em]"
                style={{ color: 'var(--blue)' }}
              >
                {item.value}
              </dd>
              <dt className="mt-2 text-[12.5px]" style={{ color: 'var(--ink-2)' }}>
                {item.label}
              </dt>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
