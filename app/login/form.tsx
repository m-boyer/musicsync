'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '../../src/auth/client';
import { useI18n } from '../components/i18n';
import { buttonClass, Notice } from '../components/ui';

export function LoginForm({ email }: { email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const result = await authClient.signIn.email({
      email: String(data.get('email')),
      password: String(data.get('password')),
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.status === 429 ? t('login.tooManyAttempts') : t('login.invalid'));
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm">{t('login.email')}</span>
        <input name="email" type="email" defaultValue={email} autoComplete="username" required />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm">{t('login.password')}</span>
        <input name="password" type="password" autoComplete="current-password" autoFocus required />
      </label>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <button className={`${buttonClass} w-full`} disabled={busy}>
        {busy ? t('login.submitting') : t('login.submit')}
      </button>
    </form>
  );
}
