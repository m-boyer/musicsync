import { redirect } from 'next/navigation';
import { getAdminSession } from '../../src/auth/guard';
import { getI18n } from '../../src/i18n/server';
import { getRuntime } from '../../src/runtime';
import { LocaleSwitcher } from '../components/i18n';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getAdminSession()) redirect('/');
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-8">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">musicsync</h1>
        <LocaleSwitcher />
      </div>
      <p className="mb-6 text-muted">{t('login.subtitle')}</p>
      <LoginForm email={getRuntime().config.ADMIN_EMAIL} />
    </main>
  );
}
