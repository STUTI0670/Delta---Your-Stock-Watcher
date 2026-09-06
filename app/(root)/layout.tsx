import TopBar from '@/components/shell/TopBar';
import MobileTabs from '@/components/shell/MobileTabs';
import { auth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect('/sign-in');

  const user = { name: session.user.name, email: session.user.email };

  return (
    <div className="wp-shell">
      <TopBar user={user} />
      {/* The bottom padding clears the mobile tab bar. */}
      <main className="wp-measure flex-1 pb-32 md:pb-24">{children}</main>
      <MobileTabs user={user} />
    </div>
  );
}
