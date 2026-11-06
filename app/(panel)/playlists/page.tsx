import { requireSession } from '../../../src/auth/guard';
import type { PlaylistInfo, Service } from '../../../src/providers/types';
import { getDirectories, getRuntime } from '../../../src/runtime';
import { safeError } from '../../../src/sync/cycle';
import { Card, Notice, PageTitle } from '../../components/ui';
import { SERVICE_NAMES } from '../labels';
import { PlaylistForms } from './forms';

type Listing = { playlists: PlaylistInfo[]; error?: string };

async function listPlaylists(): Promise<Record<Service, Listing>> {
  const runtime = getRuntime();
  return runtime.controller.exclusive(async () => {
    const directories = await getDirectories(runtime);
    const list = async (service: Service): Promise<Listing> => {
      const directory = directories[service];
      if (!directory) return { playlists: [], error: 'Save the credential for this service first.' };
      try {
        return { playlists: await directory.list() };
      } catch (error) {
        return { playlists: [], error: safeError(error).message };
      }
    };
    return { apple: await list('apple'), youtube: await list('youtube') };
  });
}

export default async function PlaylistsPage() {
  await requireSession();
  const runtime = getRuntime();
  const [settings, listings] = await Promise.all([runtime.settings.get(), listPlaylists()]);
  const pairComplete = Boolean(settings.applePlaylist && settings.youtubePlaylist);

  return (
    <>
      <PageTitle
        title="Playlists"
        description="Choose or create one playlist on each service. Only those two are synced."
      />
      <div className="space-y-4">
        {pairComplete ? (
          <Notice tone="neutral">
            Changing either one restarts syncing the pair and switches back to dry-run.
          </Notice>
        ) : null}
        {(['apple', 'youtube'] as const).map((service) => {
          const current = service === 'apple' ? settings.applePlaylist : settings.youtubePlaylist;
          const listing = listings[service];
          return (
            <Card key={service} title={SERVICE_NAMES[service]}>
              <p className="mb-3 break-words">
                {current ? (
                  <>
                    Chosen: <strong>{current.name}</strong>
                  </>
                ) : (
                  <span className="text-muted">No playlist chosen.</span>
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
