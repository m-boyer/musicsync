import path from 'node:path';
import pg from 'pg';
import { ensureAdmin } from './auth/account.js';
import { loadConfig } from './config.js';
import { readMigrations, runMigrations } from './db/migrate.js';
import { flushErrorTracking, initErrorTracking } from './errorTracking.js';
import { setReady } from './health.js';
import { logger } from './logger.js';
import { getRuntime } from './runtime.js';

/** Runs once when the server starts. If it fails the revision is never reported, so the deploy fails. */
export async function boot(): Promise<void> {
  initErrorTracking('musicsync');
  try {
    // Better Auth checks its tables when it is created, so migrations have to run first.
    const client = new pg.Client({ connectionString: loadConfig().DATABASE_URL });
    await client.connect();
    try {
      await runMigrations(client, await readMigrations(path.resolve(process.env.MIGRATIONS_DIR ?? 'migrations')));
    } finally {
      await client.end();
    }

    const runtime = getRuntime();
    const admin = await ensureAdmin(await runtime.auth.$context, runtime.config.INITIAL_ADMIN_PASSWORD);
    if (admin === 'missing_password' || admin === 'weak_password') {
      logger.error(`Admin account not created: ${admin}`);
    }

    await runtime.probes.markInterrupted();
    runtime.controller.start();
    setReady(true);
    logger.info('musicsync started', { revision: runtime.config.APP_REVISION });

    const shutdown = async (signal: string) => {
      logger.info('Shutting down', { signal });
      setReady(false);
      await runtime.controller.stop();
      await runtime.pool.end();
      await flushErrorTracking();
      process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error('Fatal error', error);
    await flushErrorTracking();
    process.exit(1);
  }
}
