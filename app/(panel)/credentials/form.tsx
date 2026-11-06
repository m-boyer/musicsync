'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useI18n } from '../../components/i18n';
import { buttonClass, Notice } from '../../components/ui';
import { saveCredential, type FormState } from '../actions';

export function CredentialForm({ service, label }: { service: string; label: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(saveCredential.bind(null, service), {});
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm">{label}</span>
        <input name="value" type="password" autoComplete="off" spellCheck={false} required />
      </label>
      {state.message ? <Notice tone={state.ok ? 'ok' : 'bad'}>{state.message}</Notice> : null}
      <button className={buttonClass} disabled={pending}>
        {pending ? t('common.saving') : t('common.save')}
      </button>
    </form>
  );
}
