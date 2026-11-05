import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncMode } from '../src/config.js';
import type { Track } from '../src/providers/types.js';
import { runCycle, safeError, type CycleOptions } from '../src/sync/cycle.js';
import { FakeRepo, fakeProvider } from './fakes.js';

vi.mock('../src/errorTracking.js', () => ({ captureError: vi.fn() }));

const now = new Date('2026-11-05T12:00:00Z');
const old = new Date('2026-11-01T00:00:00Z');
const song = (id: string, title = 'Song', artist = 'Band'): Track => ({ id, title, artist, durationMs: 200_000 });

const options = (mode: SyncMode, overrides: Partial<CycleOptions> = {}): CycleOptions => ({
  mode,
  maxOpsPerCycle: 25,
  maxDeletesPerCycle: 5,
  graceMs: 30 * 60_000,
  matchThreshold: 0.8,
  ...overrides,
});

describe('runCycle', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const cycle = (
    apple: ReturnType<typeof fakeProvider>,
    youtube: ReturnType<typeof fakeProvider>,
    opts: CycleOptions,
  ) => runCycle({ apple: apple.provider, youtube: youtube.provider, repo, options: opts, now: () => now });

  const linked = (appleId = 'a', youtubeId = 'y') => ({
    appleId,
    youtubeId,
    appleSeenAt: old,
    youtubeSeenAt: old,
    linkedAt: old,
  });

  it('links songs already on both sides without searching or writing', async () => {
    const apple = fakeProvider('apple', [song('a')]);
    const youtube = fakeProvider('youtube', [song('y')]);

    const { status, summary } = await cycle(apple, youtube, options('full'));

    expect(status).toBe('ok');
    expect(summary.linkedLocally).toBe(1);
    expect(repo.links).toMatchObject([{ appleId: 'a', youtubeId: 'y', appleSeenAt: now, youtubeSeenAt: now }]);
    expect(apple.search).not.toHaveBeenCalled();
    expect(youtube.search).not.toHaveBeenCalled();
    expect(apple.add).not.toHaveBeenCalled();
    expect(youtube.add).not.toHaveBeenCalled();
  });

  describe('dry-run', () => {
    it('changes nothing on the services, saves the match and reports the plan', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);

      const { summary } = await cycle(apple, youtube, options('dry-run'));

      expect(youtube.add).not.toHaveBeenCalled();
      expect(summary.plannedAdds).toBe(1);
      expect(summary.addSample).toEqual([{ to: 'youtube', title: 'Song', artist: 'Band' }]);
      expect(repo.links).toEqual([]);
      expect(repo.matches).toMatchObject([{ service: 'apple', sourceId: 'a', status: 'matched', targetId: 'y' }]);
    });

    it('does not search again on the next cycle', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);

      await cycle(apple, youtube, options('dry-run'));
      await cycle(apple, youtube, options('dry-run'));

      expect(youtube.search).toHaveBeenCalledTimes(1);
    });

    it('never deletes', async () => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [song('other', 'Different', 'Person')]);

      const { summary } = await cycle(apple, youtube, options('dry-run'));

      expect(apple.remove).not.toHaveBeenCalled();
      expect(summary.plannedDeletes).toBe(1);
      expect(summary.deleteDecision).toBe('not_enabled');
      expect(summary.deleteSample).toEqual([{ to: 'apple', title: 'Song', artist: 'Band' }]);
    });
  });

  describe('add-only', () => {
    it('adds in both directions and links with the target not yet seen', async () => {
      const apple = fakeProvider('apple', [song('a1', 'Alpha')], [song('a2', 'Beta')]);
      const youtube = fakeProvider('youtube', [song('y2', 'Beta')], [song('y1', 'Alpha')]);
      repo.links = [];

      const { status, summary } = await cycle(
        { ...apple, provider: { ...apple.provider, read: async () => ({ tracks: [song('a1', 'Alpha')], complete: true }) } },
        { ...youtube, provider: { ...youtube.provider, read: async () => ({ tracks: [song('y2', 'Beta')], complete: true }) } },
        options('add-only'),
      );

      expect(status).toBe('ok');
      expect(summary.added).toBe(2);
      expect(youtube.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'y1' }));
      expect(apple.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }));
      expect(repo.links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ appleId: 'a1', youtubeId: 'y1', appleSeenAt: now, youtubeSeenAt: null }),
          expect.objectContaining({ appleId: 'a2', youtubeId: 'y2', appleSeenAt: null, youtubeSeenAt: now }),
        ]),
      );
    });

    it('adds a match saved during dry-run without searching again', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);

      await cycle(apple, youtube, options('dry-run'));
      await cycle(apple, youtube, options('add-only'));

      expect(youtube.search).toHaveBeenCalledTimes(1);
      expect(youtube.add).toHaveBeenCalledTimes(1);
    });

    it('does not add the song again once linked', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);

      await cycle(apple, youtube, options('add-only'));
      await cycle(apple, youtube, options('add-only'));

      expect(youtube.add).toHaveBeenCalledTimes(1);
    });

    it('keeps the link and does not re-add a song removed on the other side', async () => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [song('z', 'Different', 'Person')], [song('y')]);

      const { summary } = await cycle(apple, youtube, options('add-only'));

      expect(apple.remove).not.toHaveBeenCalled();
      expect(youtube.add).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'y' }));
      expect(repo.links.some((link) => link.appleId === 'a')).toBe(true);
      expect(summary.deleteDecision).toBe('not_enabled');
    });

    it('links instead of adding when the search finds a song already there', async () => {
      const apple = fakeProvider('apple', [song('a', 'Song', 'Band')]);
      const youtube = fakeProvider('youtube', [song('y', 'Song (Radio Mix)', 'Other')], [{ ...song('y', 'Song', 'Band') }]);

      const { summary } = await cycle(apple, youtube, options('add-only'));

      expect(youtube.add).not.toHaveBeenCalled();
      expect(summary.linkedLocally).toBe(1);
      expect(repo.links).toMatchObject([{ appleId: 'a', youtubeId: 'y', youtubeSeenAt: now }]);
    });

    it('marks a low confidence result as pending and does not retry it', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('x', 'Nothing Alike', 'Someone')]);

      await cycle(apple, youtube, options('add-only'));
      const { summary } = await cycle(apple, youtube, options('add-only'));

      expect(youtube.add).not.toHaveBeenCalled();
      expect(youtube.search).toHaveBeenCalledTimes(1);
      expect(summary.pending).toBe(1);
      expect(repo.matches).toMatchObject([{ status: 'pending', reason: 'no_match', targetTitle: 'Nothing Alike' }]);
    });

    it('marks an empty search as pending', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], []);

      await cycle(apple, youtube, options('add-only'));

      expect(repo.matches).toMatchObject([{ status: 'pending', reason: 'no_match' }]);
    });

    it('marks a song as pending when its target is already linked to another', async () => {
      repo.links = [linked('a1', 'y')];
      const apple = fakeProvider('apple', [song('a1'), song('a2', 'Song', 'Band Two')]);
      const youtube = fakeProvider('youtube', [song('y')], [song('y', 'Song', 'Band Two')]);

      const { summary } = await cycle(apple, youtube, options('add-only'));

      expect(youtube.add).not.toHaveBeenCalled();
      expect(summary.pending).toBe(1);
      expect(repo.matches).toMatchObject([{ sourceId: 'a2', status: 'pending', reason: 'duplicate_target' }]);
    });

    it('limits work per cycle and continues on the next one', async () => {
      const tracks = [song('a1', 'One'), song('a2', 'Two'), song('a3', 'Three')];
      const apple = fakeProvider('apple', tracks);
      const youtube = fakeProvider('youtube');
      youtube.search.mockImplementation(async (track) => [{ ...track, id: `y-${track.id}` }]);

      const first = await cycle(apple, youtube, options('add-only', { maxOpsPerCycle: 2 }));
      expect(first.summary.searched + first.summary.added).toBe(2);
      expect(first.summary.deferredSearches + first.summary.deferredAdds).toBeGreaterThan(0);

      for (let i = 0; i < 4; i += 1) await cycle(apple, youtube, options('add-only', { maxOpsPerCycle: 2 }));
      expect(youtube.add).toHaveBeenCalledTimes(3);
    });

    it('defers an add when the limit was used by its own search', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);

      const { summary } = await cycle(apple, youtube, options('add-only', { maxOpsPerCycle: 1 }));

      expect(summary.deferredAdds).toBe(1);
      expect(youtube.add).not.toHaveBeenCalled();
    });

    it('reports a failed search and retries it next cycle', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);
      youtube.search.mockRejectedValueOnce(new Error('down'));

      const { status, summary } = await cycle(apple, youtube, options('add-only'));
      expect(status).toBe('partial');
      expect(summary.failures).toBe(1);

      await cycle(apple, youtube, options('add-only'));
      expect(youtube.add).toHaveBeenCalledTimes(1);
    });

    it('reports a failed add without linking, and retries it', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [], [song('y')]);
      youtube.add.mockRejectedValueOnce(new Error('down'));

      const { status } = await cycle(apple, youtube, options('add-only'));
      expect(status).toBe('partial');
      expect(repo.links).toEqual([]);

      await cycle(apple, youtube, options('add-only'));
      expect(repo.links).toHaveLength(1);
    });
  });

  describe('full', () => {
    it('replicates a deletion and drops the link', async () => {
      repo.links = [linked()];
      const appleTrack = { ...song('a'), removeId: 'i.a' };
      const apple = fakeProvider('apple', [appleTrack]);
      const youtube = fakeProvider('youtube', [song('z', 'Different', 'Person')], [song('z2', 'Nope', 'Nobody')]);

      const { summary } = await cycle(apple, youtube, options('full'));

      expect(apple.remove).toHaveBeenCalledWith(appleTrack);
      expect(summary.deleted).toBe(1);
      expect(repo.links.some((link) => link.appleId === 'a')).toBe(false);
    });

    it('never deletes on the first cycle', async () => {
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [song('z', 'Different', 'Person')], []);

      await cycle(apple, youtube, options('full'));

      expect(apple.remove).not.toHaveBeenCalled();
      expect(youtube.remove).not.toHaveBeenCalled();
    });

    it('applies no deletion when a batch is over the limit', async () => {
      const tracks = ['1', '2', '3'].map((id) => song(`a${id}`, `Track ${id}`));
      repo.links = tracks.map((track, i) => linked(track.id, `y${i}`));
      const apple = fakeProvider('apple', tracks);
      const youtube = fakeProvider('youtube', [song('z', 'Different', 'Person')], []);

      const { status, summary } = await cycle(apple, youtube, options('full', { maxDeletesPerCycle: 2 }));

      expect(apple.remove).not.toHaveBeenCalled();
      expect(status).toBe('partial');
      expect(summary.deleteDecision).toBe('over_limit');
      expect(repo.links).toHaveLength(3);
    });

    it('keeps the link when a deletion fails', async () => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [song('z', 'Different', 'Person')], []);
      apple.remove.mockRejectedValueOnce(new Error('down'));

      const { status } = await cycle(apple, youtube, options('full'));

      expect(status).toBe('partial');
      expect(repo.links.some((link) => link.appleId === 'a')).toBe(true);
    });
  });

  describe('guards', () => {
    it.each(['apple', 'youtube'] as const)('changes nothing when the %s read is incomplete', async (side) => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', []);
      (side === 'apple' ? apple : youtube).read.mockResolvedValue({ tracks: [], complete: false });

      const { status } = await cycle(apple, youtube, options('full'));

      expect(status).toBe('blocked');
      expect(apple.remove).not.toHaveBeenCalled();
      expect(youtube.remove).not.toHaveBeenCalled();
      expect(repo.links).toHaveLength(1);
    });

    it('changes nothing when one side reads empty, as an expired session could', async () => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', []);

      const { status, summary } = await cycle(apple, youtube, options('full'));

      expect(status).toBe('blocked');
      expect(summary.blockedReason).toBe('youtube_read_empty');
      expect(apple.remove).not.toHaveBeenCalled();
    });

    it('rejects when a read fails, before changing anything', async () => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [song('y')]);
      youtube.read.mockRejectedValueOnce(new Error('expired'));

      await expect(cycle(apple, youtube, options('full'))).rejects.toThrow('expired');
      expect(apple.remove).not.toHaveBeenCalled();
    });
  });

  describe('state upkeep', () => {
    it('marks a song as seen once it shows up', async () => {
      repo.links = [{ ...linked(), youtubeSeenAt: null, appleSeenAt: null }];
      await cycle(fakeProvider('apple', [song('a')]), fakeProvider('youtube', [song('y')]), options('full'));
      expect(repo.links[0]).toMatchObject({ appleSeenAt: now, youtubeSeenAt: now });
    });

    it('forgets a link gone from both sides so the song can be added again', async () => {
      repo.links = [linked()];
      const apple = fakeProvider('apple', [song('other', 'Another', 'Artist')]);
      const youtube = fakeProvider('youtube', [song('more', 'Unrelated', 'Person')], [song('y', 'Another', 'Artist')]);

      await cycle(apple, youtube, options('add-only'));

      expect(repo.links.some((link) => link.appleId === 'a')).toBe(false);
      expect(youtube.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'y' }));
    });

    it('stops retrying an added song that never appeared', async () => {
      repo.links = [{ ...linked(), youtubeSeenAt: null }];
      const apple = fakeProvider('apple', [song('a')]);
      const youtube = fakeProvider('youtube', [song('z', 'Different', 'Person')], [song('y')]);

      await cycle(apple, youtube, options('full'));
      await cycle(apple, youtube, options('full'));

      expect(apple.remove).not.toHaveBeenCalled();
      expect(youtube.add).not.toHaveBeenCalled();
      expect(repo.links.some((link) => link.appleId === 'a')).toBe(false);
      expect(repo.matches).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceId: 'a', status: 'pending', reason: 'never_appeared' })]),
      );
    });

    it('drops the result of a song that is no longer there', async () => {
      repo.matches = [{ service: 'apple', sourceId: 'gone', status: 'pending', title: 't', artist: 'a' }];
      await cycle(fakeProvider('apple'), fakeProvider('youtube'), options('dry-run'));
      expect(repo.matches).toEqual([]);
    });
  });
});

describe('safeError', () => {
  it('keeps the message and status and drops request details', () => {
    const original = Object.assign(new Error('Request failed'), {
      response: { status: 401 },
      config: { headers: { 'Music-User-Token': 'secret' } },
    });
    const safe = safeError(original);
    expect(safe.message).toBe('Request failed (HTTP 401)');
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(safe).not.toHaveProperty('config');
  });

  it('accepts values that are not errors', () => {
    expect(safeError('boom').message).toBe('boom');
    expect(safeError(null).message).toBe('null');
  });
});
