import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRuntime } from '../runtime.js';
import { isAdmin } from './account.js';

export async function getAdminSession() {
  const session = await getRuntime().auth.api.getSession({ headers: await headers() });
  return session && isAdmin(session.user.email) ? session : null;
}

/** Every panel page and server action starts with this. Layouts alone do not protect them. */
export async function requireSession() {
  const session = await getAdminSession();
  if (!session) redirect('/login');
  return session;
}
