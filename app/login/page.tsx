import { redirect } from 'next/navigation';
import { getAdminSession } from '../../src/auth/guard';
import { getRuntime } from '../../src/runtime';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getAdminSession()) redirect('/');
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">musicsync</h1>
      <p className="mb-6 text-muted">Sign in to continue.</p>
      <LoginForm email={getRuntime().config.ADMIN_EMAIL} />
    </main>
  );
}
