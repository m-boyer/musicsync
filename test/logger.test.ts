import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('../src/errorTracking.js', () => ({ captureError }));

/** The level threshold is read from LOG_LEVEL at import time, so each case gets a fresh module. */
async function loadLogger(level?: string) {
  vi.resetModules();
  if (level === undefined) vi.stubEnv('LOG_LEVEL', undefined);
  else vi.stubEnv('LOG_LEVEL', level);
  return (await import('../src/logger.js')).logger;
}

type ConsoleSpy = MockInstance<typeof console.log>;

let log: ConsoleSpy;
let err: ConsoleSpy;

function lines(spy: ConsoleSpy): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, unknown>);
}

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  captureError.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('logger', () => {
  it('writes JSON lines with time, level, message and extra fields', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-02T03:04:05.000Z') });
    try {
      const logger = await loadLogger();
      logger.info('Started', { port: 3000 });
      expect(lines(log)).toEqual([{ time: '2026-01-02T03:04:05.000Z', level: 'info', message: 'Started', port: 3000 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to info: drops debug, sends warn and error to stderr', async () => {
    const logger = await loadLogger();
    logger.debug('hidden');
    logger.info('shown');
    logger.warn('careful');
    logger.error('broken');

    expect(lines(log).map((line) => line.message)).toEqual(['shown']);
    expect(lines(err).map((line) => [line.level, line.message])).toEqual([
      ['warn', 'careful'],
      ['error', 'broken'],
    ]);
  });

  it('honours LOG_LEVEL', async () => {
    const debug = await loadLogger('debug');
    debug.debug('visible');
    expect(lines(log).map((line) => line.message)).toEqual(['visible']);

    const quiet = await loadLogger('error');
    quiet.info('no');
    quiet.warn('no');
    quiet.error('yes');
    expect(lines(log)).toHaveLength(1);
    expect(lines(err).map((line) => line.message)).toEqual(['yes']);
  });

  it('falls back to info for unknown LOG_LEVEL values', async () => {
    const logger = await loadLogger('verbose');
    logger.debug('hidden');
    logger.info('shown');
    expect(lines(log).map((line) => line.message)).toEqual(['shown']);
  });

  it('serializes Error objects with their stack and forwards them to error tracking', async () => {
    const logger = await loadLogger();
    const failure = new Error('db down');

    logger.error('Command failed', failure, { command: 'types' });

    expect(lines(err)[0]).toMatchObject({ level: 'error', message: 'Command failed', command: 'types', error: 'db down' });
    expect(lines(err)[0]!.stack).toContain('db down');
    expect(captureError).toHaveBeenCalledWith('Command failed', failure, { command: 'types' });
  });

  it('stringifies non-Error values and omits error fields when there is no error', async () => {
    const logger = await loadLogger();

    logger.error('Weird rejection', 'just a string');
    logger.error('Plain message');

    const [weird, plain] = lines(err);
    expect(weird).toMatchObject({ message: 'Weird rejection', error: 'just a string' });
    expect(weird).not.toHaveProperty('stack');
    expect(plain).not.toHaveProperty('error');
    expect(captureError).toHaveBeenLastCalledWith('Plain message', undefined, undefined);
  });
});
