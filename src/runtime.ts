import pg from 'pg';
import { createAuth, type Auth } from './auth/server.js';
import { loadConfig, type Config } from './config.js';
import { createPool } from './db/pool.js';
import { createAppleClient, createAppleDirectory, createAppleProvider } from './providers/apple.js';
import type { PlaylistDirectory, Service } from './providers/types.js';
import {
  createYouTubeClient,
  createYouTubeDirectory,
  createYouTubeProvider,
} from './providers/youtube.js';
import { CredentialsRepo } from './repos/credentials.js';
import { ProbeRepo } from './repos/probes.js';
import { SettingsRepo } from './repos/settings.js';
import { PgStateRepo } from './repos/state.js';
import { createContextLoader, type ContextLoader } from './sync/context.js';
import { SyncController } from './sync/controller.js';

export interface Runtime {
  config: Config;
  pool: pg.Pool;
  auth: Auth;
  state: PgStateRepo;
  settings: SettingsRepo;
  credentials: CredentialsRepo;
  probes: ProbeRepo;
  loader: ContextLoader;
  controller: SyncController;
}

/**
 * Playlist lists for the web. Built on demand and only used inside controller.exclusive(), since
 * the Apple client shares one configuration with the sync.
 */
export async function getDirectories(runtime: Runtime): Promise<Partial<Record<Service, PlaylistDirectory>>> {
  const [values, settings] = await Promise.all([runtime.credentials.values(), runtime.settings.get()]);
  const apple = values.apple;
  const youtube = values.youtube;
  return {
    ...(apple
      ? {
          apple: createAppleDirectory(() =>
            createAppleClient({
              userToken: apple,
              storefront: settings.appleStorefront,
              userTokenHeader: settings.appleUserTokenHeader,
              ...(settings.appleBaseUrl ? { baseURL: settings.appleBaseUrl } : {}),
            }),
          ),
        }
      : {}),
    ...(youtube ? { youtube: createYouTubeDirectory(() => createYouTubeClient(youtube)) } : {}),
  };
}

const holder = globalThis as unknown as { __musicsyncRuntime?: Runtime };

function create(): Runtime {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const state = new PgStateRepo(pool);
  const settings = new SettingsRepo(pool);
  const credentials = new CredentialsRepo(pool, config.APP_ENCRYPTION_KEY);

  const loader = createContextLoader({
    getSettings: () => settings.get(),
    getCredentials: () => credentials.values(),
    repo: state,
    createProviders: (values, current) => ({
      apple: createAppleProvider(
        () =>
          createAppleClient({
            userToken: values.apple,
            storefront: current.appleStorefront,
            userTokenHeader: current.appleUserTokenHeader,
            ...(current.appleBaseUrl ? { baseURL: current.appleBaseUrl } : {}),
          }),
        // The loader only builds providers once both playlists are chosen.
        { playlistId: current.applePlaylist!.id, removeStrategy: current.appleRemoveStrategy },
      ),
      youtube: createYouTubeProvider(() => createYouTubeClient(values.youtube), current.youtubePlaylist!.id),
    }),
  });

  return {
    config,
    pool,
    auth: createAuth({
      pool,
      secret: config.BETTER_AUTH_SECRET,
      baseURL: config.BETTER_AUTH_URL,
      adminEmail: config.ADMIN_EMAIL,
    }),
    state,
    settings,
    credentials,
    probes: new ProbeRepo(pool),
    loader,
    controller: new SyncController({
      load: () => loader.load(),
      recordNotConfigured: ({ startedAt, mode, missing }) =>
        state.recordRun({ startedAt, mode, status: 'not_configured', summary: { missing } }),
      recordFailure: ({ startedAt, error }) => state.recordRun({ startedAt, mode: '-', status: 'failed', summary: { error } }),
    }),
  };
}

/**
 * Next.js bundles instrumentation, pages and actions separately, so the single instance has to
 * live on globalThis for all of them to share one pool and one controller.
 */
export function getRuntime(): Runtime {
  holder.__musicsyncRuntime ??= create();
  return holder.__musicsyncRuntime;
}
