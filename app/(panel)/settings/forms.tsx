'use client';

import { useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../../src/auth/account';
import { authClient } from '../../../src/auth/client';
import type { EditableSettings } from '../../../src/repos/settings';
import { buttonClass, Notice } from '../../components/ui';
import { saveSettings, type FormState } from '../actions';
import { MODE_LABELS } from '../labels';

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
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});
  const [mode, setMode] = useState<string>(values.mode);
  const askConfirm = mode === 'full' && values.mode !== 'full';

  return (
    <form action={action} className="space-y-4">
      <Field label="Modo" hint={fullAllowed ? undefined : 'El modo full se habilita cuando la prueba de agregar y quitar pase en ambas playlists.'}>
        <select name="mode" value={mode} onChange={(event) => setMode(event.target.value)}>
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value} disabled={value === 'full' && !fullAllowed && values.mode !== 'full'}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {askConfirm ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="confirmFull" className="mt-1 w-auto" />
          <span>Entiendo que una canción que quite de una playlist se va a quitar también de la otra.</span>
        </label>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Intervalo (segundos)"><input name="intervalSeconds" type="number" min={60} max={86400} defaultValue={values.intervalSeconds} required /></Field>
        <Field label="País de Apple Music" hint="Dos letras, por ejemplo ar o us."><input name="appleStorefront" maxLength={2} defaultValue={values.appleStorefront} required /></Field>
        <Field label="Operaciones por ciclo"><input name="maxOpsPerCycle" type="number" min={1} max={500} defaultValue={values.maxOpsPerCycle} required /></Field>
        <Field label="Borrados máximos por ciclo" hint="Si se supera, no se borra nada."><input name="maxDeletesPerCycle" type="number" min={0} max={100} defaultValue={values.maxDeletesPerCycle} required /></Field>
        <Field label="Espera tras agregar (minutos)"><input name="addGraceMinutes" type="number" min={1} max={1440} defaultValue={values.addGraceMinutes} required /></Field>
        <Field label="Umbral de coincidencia" hint="Entre 0,5 y 1."><input name="matchThreshold" type="number" min={0.5} max={1} step={0.01} defaultValue={values.matchThreshold} required /></Field>
      </div>
      {state.message ? <Notice tone={state.ok ? 'ok' : 'bad'}>{state.message}</Notice> : null}
      <button className={buttonClass} disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</button>
    </form>
  );
}

export function PasswordForm() {
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
      setMessage({ ok: false, text: result.error.status === 429 ? 'Demasiados intentos. Esperá unos minutos.' : 'No se pudo cambiar. Revisá la contraseña actual.' });
      return;
    }
    form.reset();
    setMessage({ ok: true, text: 'Contraseña actualizada.' });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Contraseña actual"><input name="current" type="password" autoComplete="current-password" required /></Field>
      <Field label="Contraseña nueva" hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres.`}><input name="next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required /></Field>
      {message ? <Notice tone={message.ok ? 'ok' : 'bad'}>{message.text}</Notice> : null}
      <button className={buttonClass}>Cambiar contraseña</button>
    </form>
  );
}
