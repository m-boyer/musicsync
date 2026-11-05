import { describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/crypto/secrets.js';
import { CredentialsRepo } from '../src/repos/credentials.js';
import type { Queryable } from '../src/db/pool.js';

const key = Buffer.alloc(32, 7).toString('base64');
const otherKey = Buffer.alloc(32, 9).toString('base64');

describe('secrets', () => {
  it('round trips and never stores the value in clear', () => {
    const stored = encryptSecret('secret-token', 'apple', key);
    expect(stored).not.toContain('secret-token');
    expect(decryptSecret(stored, 'apple', key)).toBe('secret-token');
  });

  it('produces a different result each time', () => {
    expect(encryptSecret('x', 'apple', key)).not.toBe(encryptSecret('x', 'apple', key));
  });

  it('cannot be read with another key', () => {
    const stored = encryptSecret('secret-token', 'apple', key);
    expect(() => decryptSecret(stored, 'apple', otherKey)).toThrow();
  });

  it('cannot be moved to another service', () => {
    const stored = encryptSecret('secret-token', 'apple', key);
    expect(() => decryptSecret(stored, 'youtube', key)).toThrow();
  });

  it('detects tampering', () => {
    const parts = encryptSecret('secret-token', 'apple', key).split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join('.'), 'apple', key)).toThrow();
  });

  it('rejects an unknown format and a bad key', () => {
    expect(() => decryptSecret('plain-text', 'apple', key)).toThrow('Unknown secret format');
    expect(() => encryptSecret('x', 'apple', 'c2hvcnQ=')).toThrow('32 bytes');
  });
});

describe('CredentialsRepo', () => {
  function setup(rows: unknown[] = []) {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows }));
    return { query, repo: new CredentialsRepo({ query } as unknown as Queryable, key) };
  }

  it('saves only the encrypted value', async () => {
    const { repo, query } = setup();
    await repo.save('apple', 'secret-token');
    expect(JSON.stringify(query.mock.calls)).not.toContain('secret-token');
    const stored = query.mock.calls[0]?.[1]?.[1] as string;
    expect(decryptSecret(stored, 'apple', key)).toBe('secret-token');
  });

  it('removes a credential', async () => {
    const { repo, query } = setup();
    await repo.remove('youtube');
    expect(query.mock.calls[0]?.[1]).toEqual(['youtube']);
  });

  it('reports status without selecting the stored value', async () => {
    const at = new Date();
    const { repo, query } = setup([{ service: 'apple', updated_at: at }]);
    expect(await repo.status()).toEqual([{ service: 'apple', updatedAt: at }]);
    expect(query.mock.calls[0]?.[0]).not.toContain('ciphertext');
  });

  it('explains a credential that cannot be decrypted, without the stored value', async () => {
    const stored = encryptSecret('secret-token', 'apple', otherKey);
    const { repo } = setup([{ service: 'apple', ciphertext: stored }]);
    await expect(repo.values()).rejects.toThrow('APP_ENCRYPTION_KEY');
  });

  it('decrypts values for the sync', async () => {
    const { repo } = setup([{ service: 'apple', ciphertext: encryptSecret('secret-token', 'apple', key) }]);
    expect(await repo.values()).toEqual({ apple: 'secret-token' });
  });
});
