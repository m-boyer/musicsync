import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import type { Service } from '../providers/types.js';

export const SYNC_MODES = ['dry-run', 'add-only', 'full'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export const USER_TOKEN_HEADERS = ['Music-User-Token', 'media-user-token'] as const;
export type AppleUserTokenHeader = (typeof USER_TOKEN_HEADERS)[number];

export const editableSettings = z.object({
  mode: z.enum(SYNC_MODES),
  intervalSeconds: z.coerce.number().int().min(60).max(86_400),
  maxOpsPerCycle: z.coerce.number().int().min(1).max(500),
  maxDeletesPerCycle: z.coerce.number().int().min(0).max(100),
  addGraceMinutes: z.coerce.number().int().min(1).max(1440),
  matchThreshold: z.coerce.number().min(0.5).max(1),
  appleStorefront: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/),
});
export type EditableSettings = z.infer<typeof editableSettings>;

export interface Settings extends EditableSettings {
  appleBaseUrl: string | null;
  appleUserTokenHeader: AppleUserTokenHeader;
  appleDeleteVerifiedAt: Date | null;
  youtubeDeleteVerifiedAt: Date | null;
}

/** Deleting songs is only offered once a real test proved it works on both services. */
export function canUseFullMode(settings: Pick<Settings, 'appleDeleteVerifiedAt' | 'youtubeDeleteVerifiedAt'>): boolean {
  return settings.appleDeleteVerifiedAt !== null && settings.youtubeDeleteVerifiedAt !== null;
}

export class SettingsRepo {
  constructor(private readonly db: Queryable) {}

  async get(): Promise<Settings> {
    const { rows } = await this.db.query('SELECT * FROM settings WHERE id = 1');
    const row = rows[0];
    return {
      mode: row.mode,
      intervalSeconds: row.interval_seconds,
      maxOpsPerCycle: row.max_ops_per_cycle,
      maxDeletesPerCycle: row.max_deletes_per_cycle,
      addGraceMinutes: row.add_grace_minutes,
      matchThreshold: row.match_threshold,
      appleStorefront: row.apple_storefront,
      appleBaseUrl: row.apple_base_url,
      appleUserTokenHeader: row.apple_user_token_header,
      appleDeleteVerifiedAt: row.apple_delete_verified_at,
      youtubeDeleteVerifiedAt: row.youtube_delete_verified_at,
    };
  }

  async update(settings: EditableSettings): Promise<void> {
    await this.db.query(
      `UPDATE settings SET mode = $1, interval_seconds = $2, max_ops_per_cycle = $3, max_deletes_per_cycle = $4,
         add_grace_minutes = $5, match_threshold = $6, apple_storefront = $7, updated_at = now()
       WHERE id = 1`,
      [
        settings.mode,
        settings.intervalSeconds,
        settings.maxOpsPerCycle,
        settings.maxDeletesPerCycle,
        settings.addGraceMinutes,
        settings.matchThreshold,
        settings.appleStorefront,
      ],
    );
  }

  async setAppleConnection(baseUrl: string, header: AppleUserTokenHeader): Promise<void> {
    await this.db.query(
      'UPDATE settings SET apple_base_url = $1, apple_user_token_header = $2, updated_at = now() WHERE id = 1',
      [baseUrl, header],
    );
  }

  async markDeleteVerified(service: Service, at: Date): Promise<void> {
    const column = service === 'apple' ? 'apple_delete_verified_at' : 'youtube_delete_verified_at';
    await this.db.query(`UPDATE settings SET ${column} = $1, updated_at = now() WHERE id = 1`, [at]);
  }
}
