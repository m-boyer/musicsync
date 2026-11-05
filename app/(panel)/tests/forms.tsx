'use client';

import { useActionState } from 'react';
import { buttonClass, Card, Notice } from '../../components/ui';
import { startTest, type FormState } from '../actions';

export function TestForms({ disabled }: { disabled: boolean }) {
  const [readState, readAction, readPending] = useActionState<FormState, FormData>(startTest.bind(null, 'read'), {});
  const [writeState, writeAction, writePending] = useActionState<FormState, FormData>(startTest.bind(null, 'write'), {});

  return (
    <>
      <Card title="Probar lectura">
        <p className="mb-3 text-muted">Solo lee. Muestra qué combinación funciona en Apple Music y si YouTube sigue con sesión.</p>
        <form action={readAction}>
          {readState.message ? <div className="mb-3"><Notice tone="bad">{readState.message}</Notice></div> : null}
          <button className={buttonClass} disabled={disabled || readPending}>Probar lectura</button>
        </form>
      </Card>
      <Card title="Probar agregar y borrar">
        <p className="mb-3 text-muted">
          Agrega y quita una canción en cada servicio, y puede tardar unos minutos. No toca ninguna que ya tengas, así que elegí una que no tengas en ninguno de los dos.
        </p>
        <form action={writeAction} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm">Canción y artista</span>
            <input name="query" required maxLength={200} />
          </label>
          {writeState.message ? <Notice tone="bad">{writeState.message}</Notice> : null}
          <button className={buttonClass} disabled={disabled || writePending}>Probar agregar y borrar</button>
        </form>
      </Card>
    </>
  );
}
