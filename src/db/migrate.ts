import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { flushErrorTracking, initErrorTracking } from '../errorTracking.js';
import { logger } from '../logger.js';

export interface MigrationFile {
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

const LOCK_ID = 727_002;
const FILENAME = /^\d+_[\w-]+\.sql$/;

export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const invalid = entries.filter((name) => name.endsWith('.sql') && !FILENAME.test(name));
  if (invalid.length > 0) {
    throw new Error(`Invalid migration filenames (expected NNNN_name.sql): ${invalid.join(', ')}`);
  }
  const files = entries.filter((name) => FILENAME.test(name)).sort((a, b) => a.localeCompare(b, 'en'));
  return Promise.all(
    files.map(async (filename) => {
      const sql = await readFile(path.join(dir, filename), 'utf8');
      return { filename, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/**
 * Applies pending migrations in filename order, one transaction per file, and records the
 * execution date/time in schema_migrations. A session advisory lock keeps concurrent containers
 * from running the same migration twice.
 */
export async function runMigrations(client: MigrationClient, migrations: MigrationFile[]): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL
    )`);
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  const applied: string[] = [];
  try {
    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const done = new Map<string, string>(rows.map((row) => [row.filename, row.checksum]));

    for (const migration of migrations) {
      const previous = done.get(migration.filename);
      if (previous !== undefined) {
        if (previous !== migration.checksum) {
          throw new Error(`Migration ${migration.filename} changed after it was applied`);
        }
        continue;
      }

      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum, executed_at, duration_ms) VALUES ($1, $2, now(), $3)',
          [migration.filename, migration.checksum, Date.now() - started],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.filename} failed: ${(error as Error).message}`);
      }
      applied.push(migration.filename);
      logger.info('Migration applied', { filename: migration.filename, duration_ms: Date.now() - started });
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }
  return applied;
}

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const dir = path.resolve(process.env.MIGRATIONS_DIR ?? 'migrations');

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const applied = await runMigrations(client, await readMigrations(dir));
    logger.info('db-migrations finished', { applied: applied.length });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking('db-migrations');
  main().catch(async (error: unknown) => {
    logger.error('db-migrations failed', error);
    await flushErrorTracking();
    process.exit(1);
  });
}
