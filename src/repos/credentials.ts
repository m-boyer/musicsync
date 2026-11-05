import { decryptSecret, encryptSecret } from '../crypto/secrets.js';
import type { Queryable } from '../db/pool.js';
import type { Service } from '../providers/types.js';

export interface CredentialStatus {
  service: Service;
  updatedAt: Date;
}

export type CredentialValues = Partial<Record<Service, string>>;

export class CredentialsRepo {
  constructor(
    private readonly db: Queryable,
    private readonly key: string,
  ) {}

  async save(service: Service, value: string): Promise<void> {
    await this.db.query(
      `INSERT INTO credentials (service, ciphertext) VALUES ($1, $2)
       ON CONFLICT (service) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()`,
      [service, encryptSecret(value, service, this.key)],
    );
  }

  async remove(service: Service): Promise<void> {
    await this.db.query('DELETE FROM credentials WHERE service = $1', [service]);
  }

  /** What the web can show. Never includes the stored value. */
  async status(): Promise<CredentialStatus[]> {
    const { rows } = await this.db.query('SELECT service, updated_at FROM credentials');
    return rows.map((row) => ({ service: row.service, updatedAt: row.updated_at }));
  }

  /** Decrypted values, for the sync only. Must never reach a page or a log. */
  async values(): Promise<CredentialValues> {
    const { rows } = await this.db.query('SELECT service, ciphertext FROM credentials');
    const values: CredentialValues = {};
    for (const row of rows) {
      try {
        values[row.service as Service] = decryptSecret(row.ciphertext, row.service, this.key);
      } catch {
        throw new Error(
          'No se pueden descifrar las credenciales guardadas. Si cambió APP_ENCRYPTION_KEY, volvé a cargarlas.',
        );
      }
    }
    return values;
  }
}
