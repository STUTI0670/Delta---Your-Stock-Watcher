import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/better-auth/auth';

// Better Auth's HTTP endpoints. Required for session handling outside of the
// server actions (and by the client SDK).
export const { GET, POST } = toNextJsHandler(auth);
