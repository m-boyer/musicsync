import pg from 'pg';
import { createAuth, type Auth } from './auth/server.js';
import { loadConfig, type Config } from './config.js';
import { createPool } from './db/pool.js';
import { createAppleClient, createAppleProvider } from './providers/apple.js';
import { createYouTubeClient, createYouTubeProvider } from './providers/youtube.js';
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
      apple: createAppleProvider(() =>
        createAppleClient({
          userToken: values.apple,
          storefront: current.appleStorefront,
          userTokenHeader: current.appleUserTokenHeader,
          ...(current.appleBaseUrl ? { baseURL: current.appleBaseUrl } : {}),
        }),
      ),
      youtube: createYouTubeProvider(() => createYouTubeClient(values.youtube)),
    }),
  });

  return {
    config,
    pool,
    auth: createAuth({ pool, secret: config.BETTER_AUTH_SECRET, baseURL: config.BETTER_AUTH_URL }),
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
