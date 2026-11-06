import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import type { PlaylistRemoveStrategy } from '@syncfm/applemusic-api';
import type { PlaylistInfo, Service } from '../providers/types.js';

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
  applePlaylist: PlaylistInfo | null;
  youtubePlaylist: PlaylistInfo | null;
  appleRemoveStrategy: PlaylistRemoveStrategy | null;
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
      applePlaylist: row.apple_playlist_id ? { id: row.apple_playlist_id, name: row.apple_playlist_name } : null,
      youtubePlaylist: row.youtube_playlist_id
        ? { id: row.youtube_playlist_id, name: row.youtube_playlist_name }
        : null,
      appleRemoveStrategy: row.apple_playlist_remove_strategy,
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

  /**
   * Chooses the playlist to sync on one service. Choosing a different one also clears the state
   * of the previous pair, returns to dry-run and asks to verify removing again, in one statement,
   * so a new playlist is never read as every song having been removed.
   */
  async selectPlaylist(service: Service, playlist: PlaylistInfo): Promise<void> {
    const [idColumn, nameColumn] =
      service === 'apple' ? ['apple_playlist_id', 'apple_playlist_name'] : ['youtube_playlist_id', 'youtube_playlist_name'];
    await this.db.query(
      `WITH current AS (SELECT ${idColumn} IS DISTINCT FROM $1 AS changed FROM settings WHERE id = 1),
         clear_links AS (DELETE FROM track_links WHERE (SELECT changed FROM current)),
         clear_matches AS (DELETE FROM match_results WHERE (SELECT changed FROM current))
       UPDATE settings SET
         ${idColumn} = $1,
         ${nameColumn} = $2,
         mode = CASE WHEN (SELECT changed FROM current) THEN 'dry-run' ELSE mode END,
         apple_delete_verified_at = CASE WHEN (SELECT changed FROM current) THEN NULL ELSE apple_delete_verified_at END,
         youtube_delete_verified_at = CASE WHEN (SELECT changed FROM current) THEN NULL ELSE youtube_delete_verified_at END,
         updated_at = now()
       WHERE id = 1`,
      [playlist.id, playlist.name],
    );
  }

  async setAppleRemoveStrategy(strategy: PlaylistRemoveStrategy): Promise<void> {
    await this.db.query(
      'UPDATE settings SET apple_playlist_remove_strategy = $1, updated_at = now() WHERE id = 1',
      [strategy],
    );
  }

  async markDeleteVerified(service: Service, at: Date): Promise<void> {
    const column = service === 'apple' ? 'apple_delete_verified_at' : 'youtube_delete_verified_at';
    await this.db.query(`UPDATE settings SET ${column} = $1, updated_at = now() WHERE id = 1`, [at]);
  }
}
