import { requireSession } from '../../../src/auth/guard';
import type { PlaylistInfo, Service } from '../../../src/providers/types';
import { getDirectories, getRuntime } from '../../../src/runtime';
import { errorMessage } from '../../../src/sync/cycle';
import { render, type Locale } from '../../../src/i18n/index';
import { getI18n } from '../../../src/i18n/server';
import { Card, Notice, PageTitle } from '../../components/ui';
import { PlaylistForms } from './forms';

type Listing = { playlists: PlaylistInfo[]; error?: string };

async function listPlaylists(locale: Locale): Promise<Record<Service, Listing>> {
  const runtime = getRuntime();
  return runtime.controller.exclusive(async () => {
    const directories = await getDirectories(runtime);
    const list = async (service: Service): Promise<Listing> => {
      const directory = directories[service];
      if (!directory) return { playlists: [], error: render(locale, { key: 'errors.saveCredentialFirst' }) };
      try {
        return { playlists: await directory.list() };
      } catch (error) {
        return { playlists: [], error: render(locale, errorMessage(error)) };
      }
    };
    return { apple: await list('apple'), youtube: await list('youtube') };
  });
}

export default async function PlaylistsPage() {
  await requireSession();
  const { locale, t } = await getI18n();
  const runtime = getRuntime();
  const [settings, listings] = await Promise.all([runtime.settings.get(), listPlaylists(locale)]);
  const pairComplete = Boolean(settings.applePlaylist && settings.youtubePlaylist);

  return (
    <>
      <PageTitle title={t('playlists.title')} description={t('playlists.description')} />
      <div className="space-y-4">
        {pairComplete ? (
          <Notice tone="neutral">{t('playlists.changeWarning')}</Notice>
        ) : null}
        {(['apple', 'youtube'] as const).map((service) => {
          const current = service === 'apple' ? settings.applePlaylist : settings.youtubePlaylist;
          const listing = listings[service];
          return (
            <Card key={service} title={t(`services.${service}`)}>
              <p className="mb-3 break-words">
                {current ? (
                  <>
                    {t('playlists.chosen')} <strong>{current.name}</strong>
                  </>
                ) : (
                  <span className="text-muted">{t('playlists.noneChosen')}</span>
                )}
              </p>
              {listing.error ? (
                <Notice tone="bad">{listing.error}</Notice>
              ) : (
                <PlaylistForms
                  service={service}
                  playlists={listing.playlists}
                  currentId={current?.id}
                  askConfirm={pairComplete}
                />
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
