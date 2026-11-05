import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const required = { DATABASE_URL: 'postgres://db', YT_COOKIE: 'secret-cookie', APPLE_MEDIA_USER_TOKEN: 'secret-token' };

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig(required);
    expect(config.SYNC_MODE).toBe('dry-run');
    expect(config.SYNC_INTERVAL_SECONDS).toBe(300);
    expect(config.APPLE_BASE_URL).toBeUndefined();
  });

  it('treats an empty optional value as unset and normalizes the storefront', () => {
    const config = loadConfig({ ...required, APPLE_BASE_URL: ' ', APPLE_STOREFRONT: 'AR' });
    expect(config.APPLE_BASE_URL).toBeUndefined();
    expect(config.APPLE_STOREFRONT).toBe('ar');
  });

  it('names invalid fields without printing their values', () => {
    expect(() => loadConfig({ ...required, SYNC_MODE: 'secret-cookie', YT_COOKIE: '' })).toThrow(
      /^Invalid configuration: YT_COOKIE, SYNC_MODE$/,
    );
  });
});
