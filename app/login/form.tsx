'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '../../src/auth/client';
import { buttonClass, Notice } from '../components/ui';

export function LoginForm({ email }: { email: string }) {
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
      setError(
        result.error.status === 429
          ? 'Demasiados intentos. Esperá unos minutos.'
          : 'El email o la contraseña no son correctos.',
      );
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm">Email</span>
        <input name="email" type="email" defaultValue={email} autoComplete="username" required />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm">Contraseña</span>
        <input name="password" type="password" autoComplete="current-password" autoFocus required />
      </label>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <button className={`${buttonClass} w-full`} disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
