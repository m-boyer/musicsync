import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  let initialized = false;
  return {
    init: vi.fn(() => {
      initialized = true;
    }),
    isInitialized: vi.fn(() => initialized),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    flush: vi.fn(async () => true),
    reset: () => {
      initialized = false;
    },
  };
});

vi.mock('@sentry/node', () => sentry);

const { captureError, flushErrorTracking, initErrorTracking } = await import('../src/errorTracking.js');
const { logger } = await import('../src/logger.js');

beforeEach(() => {
  sentry.reset();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('error tracking', () => {
  it('stays disabled without SENTRY_DSN', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    initErrorTracking('bot');
    logger.error('boom', new Error('x'));
    await flushErrorTracking();
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.flush).not.toHaveBeenCalled();
  });

  it('initializes with release, environment and component tag', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@glitchtip.test/2');
    vi.stubEnv('APP_REVISION', 'abc123');
    initErrorTracking('db-migrations');
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@glitchtip.test/2',
        release: 'abc123',
        environment: 'production',
        initialScope: { tags: { component: 'db-migrations' } },
        tracesSampleRate: 0,
      }),
    );
  });

  it('forwards logger.error as an exception, or as a message when there is no error object', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@glitchtip.test/2');
    initErrorTracking('bot');
    const error = new Error('db down');

    logger.error('Command failed', error, { command: 'register' });
    expect(sentry.captureException).toHaveBeenCalledWith(error, { extra: { message: 'Command failed', command: 'register' } });

    logger.error('Something odd');
    expect(sentry.captureMessage).toHaveBeenCalledWith('Something odd', { level: 'error', extra: undefined });

    await flushErrorTracking(500);
    expect(sentry.flush).toHaveBeenCalledWith(500);
  });

  it('does not report warnings', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@glitchtip.test/2');
    initErrorTracking('bot');
    logger.warn('rate limited');
    captureError('direct', undefined);
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('honours SENTRY_ENVIRONMENT and trims the DSN', () => {
    vi.stubEnv('SENTRY_DSN', '  https://key@glitchtip.test/2  ');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'staging');
    initErrorTracking('bot');
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@glitchtip.test/2', environment: 'staging' }),
    );
  });

  it('flushes with a 2s timeout by default', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@glitchtip.test/2');
    initErrorTracking('bot');
    await flushErrorTracking();
    expect(sentry.flush).toHaveBeenCalledWith(2000);
  });
});
