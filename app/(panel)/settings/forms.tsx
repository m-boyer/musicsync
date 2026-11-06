'use client';

import { useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../../src/auth/account';
import { authClient } from '../../../src/auth/client';
import type { EditableSettings } from '../../../src/repos/settings';
import { buttonClass, Notice } from '../../components/ui';
import { saveSettings, type FormState } from '../actions';
import { useI18n } from '../../components/i18n';
import { MODES } from '../labels';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-sm text-muted">{hint}</span> : null}
    </label>
  );
}

export function SettingsForm({ values, fullAllowed }: { values: EditableSettings; fullAllowed: boolean }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});
  const [mode, setMode] = useState<string>(values.mode);
  const askConfirm = mode === 'full' && values.mode !== 'full';

  return (
    <form action={action} className="space-y-4">
      <Field label={t('settings.mode')} hint={fullAllowed ? undefined : t('settings.fullLocked')}>
        <select name="mode" value={mode} onChange={(event) => setMode(event.target.value)}>
          {MODES.map((value) => (
            <option key={value} value={value} disabled={value === 'full' && !fullAllowed && values.mode !== 'full'}>
              {t(`modes.${value}`)}
            </option>
          ))}
        </select>
      </Field>
      {askConfirm ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="confirmFull" className="mt-1 w-auto" />
          <span>{t('settings.confirmFull')}</span>
        </label>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.interval')}><input name="intervalSeconds" type="number" min={60} max={86400} defaultValue={values.intervalSeconds} required /></Field>
        <Field label={t('settings.storefront')} hint={t('settings.storefrontHint')}><input name="appleStorefront" maxLength={2} defaultValue={values.appleStorefront} required /></Field>
        <Field label={t('settings.maxOps')}><input name="maxOpsPerCycle" type="number" min={1} max={500} defaultValue={values.maxOpsPerCycle} required /></Field>
        <Field label={t('settings.maxDeletes')} hint={t('settings.maxDeletesHint')}><input name="maxDeletesPerCycle" type="number" min={0} max={100} defaultValue={values.maxDeletesPerCycle} required /></Field>
        <Field label={t('settings.grace')}><input name="addGraceMinutes" type="number" min={1} max={1440} defaultValue={values.addGraceMinutes} required /></Field>
        <Field label={t('settings.threshold')} hint={t('settings.thresholdHint')}><input name="matchThreshold" type="number" min={0.5} max={1} step={0.01} defaultValue={values.matchThreshold} required /></Field>
      </div>
      {state.message ? <Notice tone={state.ok ? 'ok' : 'bad'}>{state.message}</Notice> : null}
      <button className={buttonClass} disabled={pending}>{pending ? t('common.saving') : t('common.save')}</button>
    </form>
  );
}

export function PasswordForm() {
  const { t } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await authClient.changePassword({
      currentPassword: String(data.get('current')),
      newPassword: String(data.get('next')),
      revokeOtherSessions: true,
    });
    if (result.error) {
      setMessage({ ok: false, text: result.error.status === 429 ? t('login.tooManyAttempts') : t('settings.passwordFailed') });
      return;
    }
    form.reset();
    setMessage({ ok: true, text: t('settings.passwordUpdated') });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t('settings.currentPassword')}><input name="current" type="password" autoComplete="current-password" required /></Field>
      <Field label={t('settings.newPassword')} hint={t('settings.passwordHint', { min: MIN_PASSWORD_LENGTH })}><input name="next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required /></Field>
      {message ? <Notice tone={message.ok ? 'ok' : 'bad'}>{message.text}</Notice> : null}
      <button className={buttonClass}>{t('settings.changePassword')}</button>
    </form>
  );
}
