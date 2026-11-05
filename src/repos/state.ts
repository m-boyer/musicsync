import type { Queryable } from '../db/pool.js';
import type { Service } from '../providers/types.js';
import type { Link } from '../sync/reconcile.js';

export interface MatchResult {
  service: Service;
  sourceId: string;
  status: 'matched' | 'pending';
  title: string;
  artist: string;
  targetId?: string | undefined;
  targetTitle?: string | undefined;
  targetArtist?: string | undefined;
  score?: number | undefined;
  reason?: string | undefined;
}

export interface SyncRun {
  startedAt: Date;
  mode: string;
  status: string;
  summary: Record<string, unknown>;
}

export interface StateRepo {
  getLinks(): Promise<Link[]>;
  insertLink(link: Pick<Link, 'appleId' | 'youtubeId' | 'appleSeenAt' | 'youtubeSeenAt'>): Promise<void>;
  markSeen(service: Service, links: Link[], at: Date): Promise<void>;
  deleteLink(link: Link): Promise<void>;
  getMatches(): Promise<MatchResult[]>;
  saveMatch(match: MatchResult): Promise<void>;
  deleteMatch(service: Service, sourceId: string): Promise<void>;
  recordRun(run: SyncRun): Promise<void>;
}

const RUN_RETENTION = "now() - interval '30 days'";

export class PgStateRepo implements StateRepo {
  constructor(private readonly db: Queryable) {}

  async getLinks(): Promise<Link[]> {
    const { rows } = await this.db.query(
      'SELECT apple_id, youtube_id, apple_seen_at, youtube_seen_at, linked_at FROM track_links',
    );
    return rows.map((row) => ({
      appleId: row.apple_id,
      youtubeId: row.youtube_id,
      appleSeenAt: row.apple_seen_at,
      youtubeSeenAt: row.youtube_seen_at,
      linkedAt: row.linked_at,
    }));
  }

  async insertLink(link: Pick<Link, 'appleId' | 'youtubeId' | 'appleSeenAt' | 'youtubeSeenAt'>): Promise<void> {
    await this.db.query(
      `INSERT INTO track_links (apple_id, youtube_id, apple_seen_at, youtube_seen_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [link.appleId, link.youtubeId, link.appleSeenAt, link.youtubeSeenAt],
    );
  }

  async markSeen(service: Service, links: Link[], at: Date): Promise<void> {
    if (links.length === 0) return;
    const [seenColumn, idColumn] =
      service === 'apple' ? ['apple_seen_at', 'apple_id'] : ['youtube_seen_at', 'youtube_id'];
    const ids = links.map((link) => (service === 'apple' ? link.appleId : link.youtubeId));
    await this.db.query(`UPDATE track_links SET ${seenColumn} = $1 WHERE ${idColumn} = ANY($2)`, [at, ids]);
  }

  async deleteLink(link: Link): Promise<void> {
    await this.db.query('DELETE FROM track_links WHERE apple_id = $1 AND youtube_id = $2', [
      link.appleId,
      link.youtubeId,
    ]);
  }

  async getMatches(): Promise<MatchResult[]> {
    const { rows } = await this.db.query(
      `SELECT service, source_id, status, title, artist, target_id, target_title, target_artist, score, reason
       FROM match_results`,
    );
    return rows.map((row) => ({
      service: row.service,
      sourceId: row.source_id,
      status: row.status,
      title: row.title,
      artist: row.artist,
      targetId: row.target_id ?? undefined,
      targetTitle: row.target_title ?? undefined,
      targetArtist: row.target_artist ?? undefined,
      score: row.score ?? undefined,
      reason: row.reason ?? undefined,
    }));
  }

  async saveMatch(match: MatchResult): Promise<void> {
    await this.db.query(
      `INSERT INTO match_results
         (service, source_id, status, title, artist, target_id, target_title, target_artist, score, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (service, source_id) DO UPDATE SET
         status = EXCLUDED.status, title = EXCLUDED.title, artist = EXCLUDED.artist,
         target_id = EXCLUDED.target_id, target_title = EXCLUDED.target_title,
         target_artist = EXCLUDED.target_artist, score = EXCLUDED.score, reason = EXCLUDED.reason,
         updated_at = now()`,
      [
        match.service,
        match.sourceId,
        match.status,
        match.title,
        match.artist,
        match.targetId ?? null,
        match.targetTitle ?? null,
        match.targetArtist ?? null,
        match.score ?? null,
        match.reason ?? null,
      ],
    );
  }

  async deleteMatch(service: Service, sourceId: string): Promise<void> {
    await this.db.query('DELETE FROM match_results WHERE service = $1 AND source_id = $2', [service, sourceId]);
  }

  async recordRun(run: SyncRun): Promise<void> {
    await this.db.query('INSERT INTO sync_runs (started_at, mode, status, summary) VALUES ($1, $2, $3, $4)', [
      run.startedAt,
      run.mode,
      run.status,
      JSON.stringify(run.summary),
    ]);
    await this.db.query(`DELETE FROM sync_runs WHERE started_at < ${RUN_RETENTION}`);
  }
}
