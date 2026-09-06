import { headers } from 'next/headers';
import { auth } from '@/lib/better-auth/auth';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** The signed-in user, or null. Every Delta action is user-scoped. */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    };
  } catch (err) {
    console.error('getSessionUser failed', err);
    return null;
  }
}

export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new Error('You must be signed in.');
  return user.id;
}
