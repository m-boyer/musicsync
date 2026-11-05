import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { flushErrorTracking, initErrorTracking } from './errorTracking.js';
import { startHealthServer } from './health.js';
import { logger } from './logger.js';
import { createAppleClient, createAppleProvider } from './providers/apple.js';
import { createYouTubeClient, createYouTubeProvider } from './providers/youtube.js';
import { PgStateRepo } from './repos/state.js';
import { startLoop } from './sync/loop.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  await pool.query('SELECT 1');

  // Health only depends on the service itself: an expired credential is reported by the sync
  // cycle, and must not block deploys or restart the container.
  const health = startHealthServer(config.PORT, { revision: config.APP_REVISION, isReady: () => true });

  const apple = createAppleProvider(() =>
    createAppleClient({
      userToken: config.APPLE_MEDIA_USER_TOKEN,
      storefront: config.APPLE_STOREFRONT,
      userTokenHeader: config.APPLE_USER_TOKEN_HEADER,
      ...(config.APPLE_BASE_URL ? { baseURL: config.APPLE_BASE_URL } : {}),
    }),
  );
  const youtube = createYouTubeProvider(() => createYouTubeClient(config.YT_COOKIE));

  const loop = startLoop(
    {
      apple,
      youtube,
      repo: new PgStateRepo(pool),
      options: {
        mode: config.SYNC_MODE,
        maxOpsPerCycle: config.MAX_OPS_PER_CYCLE,
        maxDeletesPerCycle: config.MAX_DELETES_PER_CYCLE,
        graceMs: config.ADD_GRACE_MINUTES * 60_000,
        matchThreshold: config.MATCH_THRESHOLD,
      },
    },
    config.SYNC_INTERVAL_SECONDS * 1000,
  );
  logger.info('musicsync started', { mode: config.SYNC_MODE, revision: config.APP_REVISION });

  const shutdown = async (signal: string) => {
    logger.info('Shutting down', { signal });
    await loop.stop();
    health.close();
    await pool.end();
    await flushErrorTracking();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking('musicsync');
  main().catch(async (error: unknown) => {
    logger.error('Fatal error', error);
    await flushErrorTracking();
    process.exit(1);
  });
}
