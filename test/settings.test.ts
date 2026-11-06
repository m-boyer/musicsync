import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../src/db/pool.js';
import { ProbeRepo } from '../src/repos/probes.js';
import { canUseFullMode, editableSettings, SettingsRepo } from '../src/repos/settings.js';

const at = new Date();

function setup(rows: unknown[] = []) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows }));
  return { query, db: { query } as unknown as Queryable };
}

describe('canUseFullMode', () => {
  it('needs deleting verified on both services', () => {
    expect(canUseFullMode({ appleDeleteVerifiedAt: at, youtubeDeleteVerifiedAt: at })).toBe(true);
    expect(canUseFullMode({ appleDeleteVerifiedAt: at, youtubeDeleteVerifiedAt: null })).toBe(false);
    expect(canUseFullMode({ appleDeleteVerifiedAt: null, youtubeDeleteVerifiedAt: at })).toBe(false);
  });
});

describe('editableSettings', () => {
  const valid = {
    mode: 'add-only',
    intervalSeconds: '300',
    maxOpsPerCycle: '25',
    maxDeletesPerCycle: '5',
    addGraceMinutes: '30',
    matchThreshold: '0.8',
    appleStorefront: ' AR ',
  };

  it('parses form values', () => {
    expect(editableSettings.parse(valid)).toMatchObject({ intervalSeconds: 300, appleStorefront: 'ar' });
  });

  it.each([
    { intervalSeconds: '10' },
    { mode: 'other' },
    { matchThreshold: '0.1' },
    { appleStorefront: 'arg' },
    { maxOpsPerCycle: '0' },
  ])('rejects %j', (bad) => {
    expect(editableSettings.safeParse({ ...valid, ...bad }).success).toBe(false);
  });
});

describe('SettingsRepo', () => {
  it('maps the row', async () => {
    const { db } = setup([
      {
        mode: 'dry-run',
        interval_seconds: 300,
        max_ops_per_cycle: 25,
        max_deletes_per_cycle: 5,
        add_grace_minutes: 30,
        match_threshold: 0.8,
        apple_storefront: 'ar',
        apple_playlist_id: 'p.1',
        apple_playlist_name: 'Mix',
        youtube_playlist_id: null,
        youtube_playlist_name: null,
        apple_playlist_remove_strategy: 'query',
        apple_base_url: null,
        apple_user_token_header: 'Music-User-Token',
        apple_delete_verified_at: at,
        youtube_delete_verified_at: null,
      },
    ]);
    expect(await new SettingsRepo(db).get()).toMatchObject({
      mode: 'dry-run',
      intervalSeconds: 300,
      appleStorefront: 'ar',
      appleDeleteVerifiedAt: at,
      youtubeDeleteVerifiedAt: null,
      applePlaylist: { id: 'p.1', name: 'Mix' },
      youtubePlaylist: null,
      appleRemoveStrategy: 'query',
    });
  });

  it('chooses a playlist and resets the pair in one statement only when it changes', async () => {
    const { db, query } = setup();
    const repo = new SettingsRepo(db);
    await repo.selectPlaylist('youtube', { id: 'PL1', name: 'Mix' });
    const [sql, values] = query.mock.calls[0] ?? [];
    expect(values).toEqual(['PL1', 'Mix']);
    expect(sql).toContain('youtube_playlist_id IS DISTINCT FROM $1');
    expect(sql).toContain('DELETE FROM track_links WHERE (SELECT changed FROM current)');
    expect(sql).toContain('DELETE FROM match_results WHERE (SELECT changed FROM current)');
    expect(sql).toContain("THEN 'dry-run' ELSE mode END");
    expect(sql).toContain('apple_delete_verified_at = CASE WHEN (SELECT changed FROM current) THEN NULL');
    expect(query).toHaveBeenCalledTimes(1);

    await repo.selectPlaylist('apple', { id: 'p.1', name: 'Other' });
    expect(query.mock.calls[1]?.[0]).toContain('apple_playlist_id = $1');
  });

  it('saves the Apple removal strategy', async () => {
    const { db, query } = setup();
    await new SettingsRepo(db).setAppleRemoveStrategy('body');
    expect(query.mock.calls[0]?.[1]).toEqual(['body']);
  });

  it('updates editable values', async () => {
    const { db, query } = setup();
    await new SettingsRepo(db).update({
      mode: 'full',
      intervalSeconds: 60,
      maxOpsPerCycle: 1,
      maxDeletesPerCycle: 2,
      addGraceMinutes: 3,
      matchThreshold: 0.9,
      appleStorefront: 'us',
    });
    expect(query.mock.calls[0]?.[1]).toEqual(['full', 60, 1, 2, 3, 0.9, 'us']);
  });

  it('saves the Apple connection', async () => {
    const { db, query } = setup();
    await new SettingsRepo(db).setAppleConnection('https://host', 'media-user-token');
    expect(query.mock.calls[0]?.[1]).toEqual(['https://host', 'media-user-token']);
  });

  it('marks deleting as verified per service', async () => {
    const { db, query } = setup();
    const repo = new SettingsRepo(db);
    await repo.markDeleteVerified('apple', at);
    await repo.markDeleteVerified('youtube', at);
    expect(query.mock.calls[0]?.[0]).toContain('apple_delete_verified_at');
    expect(query.mock.calls[1]?.[0]).toContain('youtube_delete_verified_at');
  });
});

describe('ProbeRepo', () => {
  it('starts, adds steps and finishes', async () => {
    const { db, query } = setup([{ id: '7' }]);
    const repo = new ProbeRepo(db);
    expect(await repo.start('read')).toBe('7');
    await repo.addStep('7', { name: 'x', ok: true });
    await repo.finish('7');
    expect(query.mock.calls[1]?.[1]).toEqual(['[{"name":"x","ok":true}]', '7']);
    expect(query.mock.calls[2]?.[0]).toContain("status = 'finished'");
    expect(query.mock.calls[3]?.[0]).toContain('DELETE FROM probe_runs');
  });

  it('marks unfinished runs as interrupted', async () => {
    const { db, query } = setup();
    await new ProbeRepo(db).markInterrupted();
    expect(query.mock.calls[0]?.[0]).toContain("status = 'interrupted'");
  });

  it('maps recent runs', async () => {
    const { db } = setup([{ id: '1', kind: 'write', status: 'finished', steps: [], started_at: at, finished_at: at }]);
    expect(await new ProbeRepo(db).recent(5)).toEqual([
      { id: '1', kind: 'write', status: 'finished', steps: [], startedAt: at, finishedAt: at },
    ]);
  });
});
