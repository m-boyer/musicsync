'use client';

import { useActionState, useState } from 'react';
import type { PlaylistInfo } from '../../../src/providers/types';
import { useI18n } from '../../components/i18n';
import { buttonClass, Notice, secondaryButtonClass } from '../../components/ui';
import { choosePlaylist, createPlaylist, type FormState } from '../actions';

function Confirm() {
  const { t } = useI18n();
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" name="confirmChange" className="mt-1 w-auto" />
      <span>{t('playlists.confirmChange')}</span>
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
  const { t } = useI18n();
  const [chooseState, chooseAction, choosing] = useActionState<FormState, FormData>(choosePlaylist.bind(null, service), {});
  const [createState, createAction, creating] = useActionState<FormState, FormData>(createPlaylist.bind(null, service), {});
  const [selected, setSelected] = useState(currentId ?? '');
  const changing = askConfirm && selected !== '' && selected !== currentId;

  return (
    <div className="space-y-5">
      <form action={chooseAction} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm">{t('playlists.yours')}</span>
          {playlists.length === 0 ? (
            <span className="block text-muted">{t('playlists.noneEditable')}</span>
          ) : (
            <select name="id" value={selected} onChange={(event) => setSelected(event.target.value)} required>
              <option value="" disabled>
                {t('playlists.chooseOne')}
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
            {choosing ? t('common.saving') : t('playlists.use')}
          </button>
        ) : null}
      </form>

      <form action={createAction} className="space-y-3 border-t border-line pt-4">
        <label className="block">
          <span className="mb-1 block text-sm">{t('playlists.createNew')}</span>
          <input name="name" maxLength={100} placeholder={t('playlists.namePlaceholder')} required />
        </label>
        {service === 'youtube' ? <p className="text-sm text-muted">{t('playlists.createdPrivate')}</p> : null}
        {askConfirm ? <Confirm /> : null}
        {createState.message ? <Notice tone={createState.ok ? 'ok' : 'bad'}>{createState.message}</Notice> : null}
        <button className={secondaryButtonClass} disabled={creating}>
          {creating ? t('playlists.creating') : t('playlists.create')}
        </button>
      </form>
    </div>
  );
}
