import { describe, expect, it, vi } from 'vitest';
import { PgStateRepo } from '../src/repos/state.js';
import type { Queryable } from '../src/db/pool.js';

const at = new Date('2026-11-05T12:00:00Z');
const link = { appleId: 'a', youtubeId: 'y', appleSeenAt: at, youtubeSeenAt: null, linkedAt: at };

function setup(rows: unknown[] = []) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows }));
  return { query, repo: new PgStateRepo({ query } as unknown as Queryable) };
}

describe('PgStateRepo', () => {
  it('maps links', async () => {
    const { repo } = setup([{ apple_id: 'a', youtube_id: 'y', apple_seen_at: at, youtube_seen_at: null, linked_at: at }]);
    expect(await repo.getLinks()).toEqual([link]);
  });

  it('inserts links without failing on a repeated one', async () => {
    const { repo, query } = setup();
    await repo.insertLink(link);
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('ON CONFLICT DO NOTHING'), ['a', 'y', at, null]]);
  });

  it('marks seen on the right column and skips an empty list', async () => {
    const { repo, query } = setup();
    await repo.markSeen('apple', [], at);
    expect(query).not.toHaveBeenCalled();

    await repo.markSeen('apple', [link], at);
    await repo.markSeen('youtube', [link], at);
    expect(query.mock.calls[0]).toEqual([expect.stringContaining('apple_seen_at = $1 WHERE apple_id'), [at, ['a']]]);
    expect(query.mock.calls[1]).toEqual([expect.stringContaining('youtube_seen_at = $1 WHERE youtube_id'), [at, ['y']]]);
  });

  it('deletes a link', async () => {
    const { repo, query } = setup();
    await repo.deleteLink(link);
    expect(query.mock.calls[0]?.[1]).toEqual(['a', 'y']);
  });

  it('maps matches and leaves empty columns unset', async () => {
    const { repo } = setup([
      { service: 'apple', source_id: 's', status: 'matched', title: 't', artist: 'r', target_id: 'x', target_title: 'tt', target_artist: 'ta', score: 0.9, reason: null },
      { service: 'youtube', source_id: 's2', status: 'pending', title: 't', artist: 'r', target_id: null, target_title: null, target_artist: null, score: null, reason: 'no_match' },
    ]);
    const [matched, pending] = await repo.getMatches();
    expect(matched).toMatchObject({ sourceId: 's', targetId: 'x', score: 0.9, reason: undefined });
    expect(pending).toMatchObject({ sourceId: 's2', targetId: undefined, reason: 'no_match' });
  });

  it('saves a match with empty values as null', async () => {
    const { repo, query } = setup();
    await repo.saveMatch({ service: 'apple', sourceId: 's', status: 'pending', title: 't', artist: 'a' });
    expect(query.mock.calls[0]?.[1]).toEqual(['apple', 's', 'pending', 't', 'a', null, null, null, null, null]);
    await repo.saveMatch({ service: 'apple', sourceId: 's', status: 'matched', title: 't', artist: 'a', targetId: 'x', targetTitle: 'tt', targetArtist: 'ta', score: 1, reason: 'r' });
    expect(query.mock.calls[1]?.[1]).toEqual(['apple', 's', 'matched', 't', 'a', 'x', 'tt', 'ta', 1, 'r']);
  });

  it('deletes a match', async () => {
    const { repo, query } = setup();
    await repo.deleteMatch('youtube', 's');
    expect(query.mock.calls[0]?.[1]).toEqual(['youtube', 's']);
  });

  it('finds one match', async () => {
    const { repo } = setup([{ service: 'apple', source_id: 's', status: 'pending', title: 't', artist: 'r' }]);
    expect(await repo.getMatch('apple', 's')).toMatchObject({ sourceId: 's' });
    expect(await repo.getMatch('youtube', 's')).toBeUndefined();
  });

  it('maps recent runs', async () => {
    const { repo } = setup([{ id: '1', started_at: at, finished_at: at, mode: 'full', status: 'ok', summary: {} }]);
    expect(await repo.recentRuns(1)).toEqual([{ id: '1', startedAt: at, finishedAt: at, mode: 'full', status: 'ok', summary: {} }]);
  });

  it('records a run and clears old ones', async () => {
    const { repo, query } = setup();
    await repo.recordRun({ startedAt: at, mode: 'full', status: 'ok', summary: { added: 1 } });
    expect(query.mock.calls[0]?.[1]).toEqual([at, 'full', 'ok', '{"added":1}']);
    expect(query.mock.calls[1]?.[0]).toContain('DELETE FROM sync_runs');
  });
});
