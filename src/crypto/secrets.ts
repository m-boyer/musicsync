import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('The encryption key must be 32 bytes in base64');
  return key;
}

/**
 * Encrypts a value bound to a label, so a stored value cannot be moved to another service.
 * The output is safe to store: `v1.<iv>.<tag>.<data>`.
 */
export function encryptSecret(value: string, label: string, base64Key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, parseKey(base64Key), iv);
  cipher.setAAD(Buffer.from(label));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join('.');
}

export function decryptSecret(stored: string, label: string, base64Key: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Unknown secret format');
  const decipher = createDecipheriv(ALGORITHM, parseKey(base64Key), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(label));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
