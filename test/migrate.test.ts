import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, readMigrations, runMigrations, type MigrationClient, type MigrationFile } from '../src/db/migrate.js';

interface FakePgClient {
  options: unknown;
  applied: string[];
  connect: () => Promise<void>;
  end: () => Promise<void>;
}

const pgState = vi.hoisted(() => ({ clients: [] as FakePgClient[], failOn: undefined as string | undefined }));

vi.mock('pg', () => ({
  default: {
    Client: class {
      readonly applied: string[] = [];
      readonly connect = vi.fn(async () => undefined);
      readonly end = vi.fn(async () => undefined);

      constructor(readonly options: unknown) {
        pgState.clients.push(this);
      }

      async query(text: string) {
        if (text === 'SELECT filename, checksum FROM schema_migrations') return { rows: [] };
        if (pgState.failOn && text.includes(pgState.failOn)) throw new Error('boom');
        if (/^INSERT INTO schema_migrations/.test(text)) this.applied.push(text);
        return { rows: [] };
      }
    },
  },
}));

class FakeClient implements MigrationClient {
  readonly executed: string[] = [];
  readonly recorded = new Map<string, string>();
  failOn?: string;

  async query(text: string, values?: unknown[]) {
    if (text.startsWith('SELECT filename, checksum')) {
      return { rows: [...this.recorded].map(([filename, checksum]) => ({ filename, checksum })) };
    }
    if (text.startsWith('INSERT INTO schema_migrations')) {
      this.recorded.set(values![0] as string, values![1] as string);
    } else if (!/^(\s*CREATE TABLE IF NOT EXISTS schema_migrations|SELECT pg_advisory|BEGIN|COMMIT|ROLLBACK)/.test(text)) {
      if (this.failOn && text.includes(this.failOn)) throw new Error('boom');
      this.executed.push(text);
    }
    return { rows: [] };
  }
}

const file = (filename: string, sql: string, checksum = sql): MigrationFile => ({ filename, sql, checksum });

describe('runMigrations', () => {
  it('applies pending migrations in order and records them', async () => {
    const client = new FakeClient();
    const applied = await runMigrations(client, [file('0001_a.sql', 'A'), file('0002_b.sql', 'B')]);
    expect(applied).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(client.executed).toEqual(['A', 'B']);
    expect([...client.recorded.keys()]).toEqual(['0001_a.sql', '0002_b.sql']);
  });

  it('skips migrations already applied', async () => {
    const client = new FakeClient();
    client.recorded.set('0001_a.sql', 'A');
    expect(await runMigrations(client, [file('0001_a.sql', 'A'), file('0002_b.sql', 'B')])).toEqual(['0002_b.sql']);
    expect(client.executed).toEqual(['B']);
  });

  it('fails when an applied migration was modified', async () => {
    const client = new FakeClient();
    client.recorded.set('0001_a.sql', 'old');
    await expect(runMigrations(client, [file('0001_a.sql', 'A')])).rejects.toThrow(/changed/);
  });

  it('stops at the first failing migration without recording it', async () => {
    const client = new FakeClient();
    client.failOn = 'B';
    await expect(runMigrations(client, [file('0001_a.sql', 'A'), file('0002_b.sql', 'B'), file('0003_c.sql', 'C')])).rejects.toThrow(
      /0002_b\.sql failed/,
    );
    expect([...client.recorded.keys()]).toEqual(['0001_a.sql']);
  });
});

describe('readMigrations', () => {
  it('sorts by filename and hashes contents', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    await writeFile(path.join(dir, '0002_second.sql'), 'SELECT 2;');
    await writeFile(path.join(dir, '0001_first.sql'), 'SELECT 1;');
    await writeFile(path.join(dir, 'README.md'), 'ignored');
    const files = await readMigrations(dir);
    expect(files.map((f) => f.filename)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(files[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects badly named sql files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    await writeFile(path.join(dir, 'init.sql'), 'SELECT 1;');
    await expect(readMigrations(dir)).rejects.toThrow(/Invalid migration filenames/);
  });
});

describe('main', () => {
  let dir: string;

  beforeEach(async () => {
    pgState.clients = [];
    pgState.failOn = undefined;
    dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    await writeFile(path.join(dir, '0001_first.sql'), 'SELECT 1;');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('requires DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(main()).rejects.toThrow('DATABASE_URL is required');
    expect(pgState.clients).toHaveLength(0);
  });

  it('applies the migrations in MIGRATIONS_DIR and closes the connection', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://db.test/bot');
    vi.stubEnv('MIGRATIONS_DIR', dir);
    await main();
    const [client] = pgState.clients;
    expect(client!.options).toEqual({ connectionString: 'postgres://db.test/bot' });
    expect(client!.connect).toHaveBeenCalledOnce();
    expect(client!.applied).toHaveLength(1);
    expect(client!.end).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"applied":1'));
  });

  it('defaults to ./migrations', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://db.test/bot');
    vi.stubEnv('MIGRATIONS_DIR', undefined);
    await main();
    const shipped = await readMigrations(path.resolve('migrations'));
    expect(pgState.clients[0]!.applied).toHaveLength(shipped.length);
  });

  it('closes the connection when a migration fails', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://db.test/bot');
    vi.stubEnv('MIGRATIONS_DIR', dir);
    pgState.failOn = 'SELECT 1;';
    await expect(main()).rejects.toThrow(/0001_first\.sql failed/);
    expect(pgState.clients[0]!.end).toHaveBeenCalledOnce();
  });
});

describe('entrypoint guard', () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('runs main and exits with 1 on failure when executed directly', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SENTRY_DSN', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = [argv[0]!, fileURLToPath(new URL('../src/db/migrate.ts', import.meta.url))];
    vi.resetModules();
    await import('../src/db/migrate.js');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('db-migrations failed'));
  });

  it('does nothing when imported without a script path', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.argv = [argv[0]!];
    vi.resetModules();
    await import('../src/db/migrate.js');
    expect(exit).not.toHaveBeenCalled();
  });
});
