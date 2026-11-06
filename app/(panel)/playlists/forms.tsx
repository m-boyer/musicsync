'use client';

import { useActionState, useState } from 'react';
import type { PlaylistInfo } from '../../../src/providers/types';
import { buttonClass, Notice, secondaryButtonClass } from '../../components/ui';
import { choosePlaylist, createPlaylist, type FormState } from '../actions';

function Confirm() {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" name="confirmChange" className="mt-1 w-auto" />
      <span>Entiendo que la sincronización del par actual vuelve a empezar.</span>
    </label>
  );
}

export function PlaylistForms({
  service,
  playlists,
  currentId,
  askConfirm,
}: {
  service: 'apple' | 'youtube';
  playlists: PlaylistInfo[];
  currentId: string | undefined;
  askConfirm: boolean;
}) {
  const [chooseState, chooseAction, choosing] = useActionState<FormState, FormData>(choosePlaylist.bind(null, service), {});
  const [createState, createAction, creating] = useActionState<FormState, FormData>(createPlaylist.bind(null, service), {});
  const [selected, setSelected] = useState(currentId ?? '');
  const changing = askConfirm && selected !== '' && selected !== currentId;

  return (
    <div className="space-y-5">
      <form action={chooseAction} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm">Tus playlists</span>
          {playlists.length === 0 ? (
            <span className="block text-muted">No encontré playlists que puedas editar. Creá una abajo.</span>
          ) : (
            <select name="id" value={selected} onChange={(event) => setSelected(event.target.value)} required>
              <option value="" disabled>
                Elegí una
              </option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          )}
        </label>
        {changing ? <Confirm /> : null}
        {chooseState.message ? <Notice tone={chooseState.ok ? 'ok' : 'bad'}>{chooseState.message}</Notice> : null}
        {playlists.length > 0 ? (
          <button className={buttonClass} disabled={choosing || selected === '' || selected === currentId}>
            {choosing ? 'Guardando…' : 'Usar esta playlist'}
          </button>
        ) : null}
      </form>

      <form action={createAction} className="space-y-3 border-t border-line pt-4">
        <label className="block">
          <span className="mb-1 block text-sm">Crear una nueva</span>
          <input name="name" maxLength={100} placeholder="Nombre de la playlist" required />
        </label>
        {service === 'youtube' ? <p className="text-sm text-muted">Se crea como privada.</p> : null}
        {askConfirm ? <Confirm /> : null}
        {createState.message ? <Notice tone={createState.ok ? 'ok' : 'bad'}>{createState.message}</Notice> : null}
        <button className={secondaryButtonClass} disabled={creating}>
          {creating ? 'Creando…' : 'Crear y usar'}
        </button>
      </form>
    </div>
  );
}
