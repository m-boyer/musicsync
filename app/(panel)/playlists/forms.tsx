'use client';

import { useActionState, useState } from 'react';
import type { PlaylistInfo } from '../../../src/providers/types';
import { buttonClass, Notice, secondaryButtonClass } from '../../components/ui';
import { choosePlaylist, createPlaylist, type FormState } from '../actions';

function Confirm() {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" name="confirmChange" className="mt-1 w-auto" />
      <span>I understand that syncing the current pair starts over.</span>
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
          <span className="mb-1 block text-sm">Your playlists</span>
          {playlists.length === 0 ? (
            <span className="block text-muted">No playlists you can edit were found. Create one below.</span>
          ) : (
            <select name="id" value={selected} onChange={(event) => setSelected(event.target.value)} required>
              <option value="" disabled>
                Choose one
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
            {choosing ? 'Saving…' : 'Use this playlist'}
          </button>
        ) : null}
      </form>

      <form action={createAction} className="space-y-3 border-t border-line pt-4">
        <label className="block">
          <span className="mb-1 block text-sm">Create a new one</span>
          <input name="name" maxLength={100} placeholder="Playlist name" required />
        </label>
        {service === 'youtube' ? <p className="text-sm text-muted">It is created as private.</p> : null}
        {askConfirm ? <Confirm /> : null}
        {createState.message ? <Notice tone={createState.ok ? 'ok' : 'bad'}>{createState.message}</Notice> : null}
        <button className={secondaryButtonClass} disabled={creating}>
          {creating ? 'Creating…' : 'Create and use'}
        </button>
      </form>
    </div>
  );
}
