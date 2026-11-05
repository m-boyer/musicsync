import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const required = {
  DATABASE_URL: 'postgres://db',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  BETTER_AUTH_SECRET: 'secret-value-that-is-long-enough-to-pass',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(required);
    expect(config.BETTER_AUTH_URL).toBe('https://musicsync.matiasboyer.com');
    expect(config.INITIAL_ADMIN_PASSWORD).toBeUndefined();
  });

  it('treats an empty optional value as unset', () => {
    expect(loadConfig({ ...required, INITIAL_ADMIN_PASSWORD: ' ' }).INITIAL_ADMIN_PASSWORD).toBeUndefined();
  });

  it('rejects a key of the wrong size', () => {
    expect(() => loadConfig({ ...required, APP_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow('APP_ENCRYPTION_KEY');
  });

  it('names invalid fields without printing their values', () => {
    const run = () => loadConfig({ ...required, BETTER_AUTH_SECRET: 'tiny-secret', DATABASE_URL: '' });
    expect(run).toThrow(/^Invalid configuration: DATABASE_URL, BETTER_AUTH_SECRET$/);
  });
});
