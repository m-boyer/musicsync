import type { AppleMusic } from '@syncfm/applemusic-api';
import { describe, expect, it, vi } from 'vitest';
import { APPLE_HEADERS, APPLE_HOSTS, runReadProbe, runWriteProbe, type ProbeDeps } from '../src/probe/run.js';
import type { ProbeStep } from '../src/repos/probes.js';
import { fakeProvider } from './fakes.js';

const entry = { id: 'i.1', attributes: { playParams: { catalogId: 'c1' } } };
const COMBINATIONS = APPLE_HOSTS.length * APPLE_HEADERS.length;

function appleFake() {
  const Library = {
    getSongs: vi.fn(async () => ({ data: [], meta: { total: 3 } })),
    getAllPlaylistTracks: vi.fn(async () => ({ items: [] as (typeof entry)[], complete: true })),
    addTracksToPlaylist: vi.fn(async () => {}),
    removeTracksFromPlaylist: vi.fn(async (_playlist: string, _ids: string[], _strategy: string) => {}),
  };
  const Search = { search: vi.fn(async () => ({ results: { songs: { data: [{ id: 'c1', attributes: { name: 'Test' } }] } } })) };
  return { Library, Search, client: { Library, Search } as unknown as AppleMusic };
}

/** The playlist has the song only between adding it and a removal that works. */
function livePlaylist(apple: ReturnType<typeof appleFake>, worksWith?: string) {
  let has = false;
  apple.Library.addTracksToPlaylist.mockImplementation(async () => {
    has = true;
  });
  apple.Library.removeTracksFromPlaylist.mockImplementation(async (_p, _ids, strategy) => {
    if (!worksWith || strategy === worksWith) has = false;
  });
  apple.Library.getAllPlaylistTracks.mockImplementation(async () => ({ items: has ? [entry] : [], complete: true }));
}

function setup(overrides: Partial<ProbeDeps> = {}, apple = appleFake()) {
  const steps: ProbeStep[] = [];
  const appleRemovalVerified = vi.fn(async () => {});
  const youtubeRemovalVerified = vi.fn(async () => {});
  const deps: ProbeDeps = {
    appleToken: 'token',
    applePlaylistId: 'p.1',
    storefront: 'ar',
    createAppleClient: vi.fn(async () => apple.client),
    youtube: undefined,
    report: async (step) => {
      steps.push(step);
    },
    appleRemovalVerified,
    youtubeRemovalVerified,
    waitMs: 0,
    ...overrides,
  };
  return { deps, steps, apple, appleRemovalVerified, youtubeRemovalVerified };
}

const named = (steps: ProbeStep[], text: string) => steps.filter((step) => step.name.includes(text));

describe('runReadProbe', () => {
  it('tries every Apple connection, tries the saved one first, and reads the playlist', async () => {
    const { deps, steps, apple } = setup({
      preferredConnection: { baseUrl: APPLE_HOSTS[1]!, header: APPLE_HEADERS[1]! },
    });
    apple.Library.getAllPlaylistTracks.mockResolvedValue({ items: [entry], complete: true });

    await runReadProbe(deps);

    expect(deps.createAppleClient).toHaveBeenCalledTimes(COMBINATIONS + 1);
    expect(steps[0]).toMatchObject({ ok: true, connection: { baseUrl: APPLE_HOSTS[1], header: APPLE_HEADERS[1] } });
    expect(named(steps, 'read the chosen playlist')[0]).toMatchObject({ ok: true, detail: '1 songs' });
  });

  it('reports a failed connection without credentials', async () => {
    const { deps, steps } = setup({
      createAppleClient: vi.fn(async () => {
        throw Object.assign(new Error('Forbidden'), { response: { status: 403 }, config: { headers: { token: 'secret' } } });
      }),
    });
    await runReadProbe(deps);
    expect(steps[0]).toMatchObject({ ok: false, detail: 'Forbidden (HTTP 403)' });
    expect(JSON.stringify(steps)).not.toContain('secret');
  });

  it('reports an incomplete or failed playlist read', async () => {
    const { deps, steps, apple } = setup();
    apple.Library.getAllPlaylistTracks.mockResolvedValueOnce({ items: [], complete: false });
    await runReadProbe(deps);
    expect(named(steps, 'read the chosen playlist')[0]).toMatchObject({ ok: false, detail: '0 songs, incomplete read' });

    apple.Library.getAllPlaylistTracks.mockRejectedValueOnce(new Error('gone'));
    await runReadProbe(deps);
    expect(named(steps, 'read the chosen playlist')[1]).toMatchObject({ ok: false, detail: 'gone' });
  });

  it('reports what is missing', async () => {
    const noPlaylist = setup({ applePlaylistId: undefined, youtubeMissing: 'No playlist chosen' });
    await runReadProbe(noPlaylist.deps);
    expect(named(noPlaylist.steps, 'Apple: playlist')[0]?.detail).toBe('No playlist chosen');
    expect(noPlaylist.steps.at(-1)).toEqual({ name: 'YouTube', ok: false, detail: 'No playlist chosen' });

    const noToken = setup({ appleToken: undefined });
    await runReadProbe(noToken.deps);
    expect(noToken.steps).toEqual([
      { name: 'Apple', ok: false, detail: 'Token not saved' },
      { name: 'YouTube', ok: false, detail: 'Cookie not saved' },
    ]);
  });

  it('reports the YouTube playlist read', async () => {
    const youtube = fakeProvider('youtube', [{ id: 'y', title: 't', artist: 'a' }]);
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runReadProbe(deps);
    expect(named(steps, 'YouTube')[0]).toMatchObject({ ok: true, detail: '1 songs' });

    youtube.read.mockRejectedValueOnce(new Error('expired'));
    await runReadProbe(deps);
    expect(named(steps, 'YouTube')[1]).toMatchObject({ ok: false, detail: 'expired' });
  });
});

describe('runWriteProbe on Apple', () => {
  it('adds, finds the removal that works and saves it', async () => {
    const apple = appleFake();
    livePlaylist(apple, 'body');
    const { deps, steps, appleRemovalVerified } = setup({}, apple);

    await runWriteProbe(deps, 'test song');

    expect(apple.Library.addTracksToPlaylist).toHaveBeenCalledWith('p.1', ['c1']);
    expect(apple.Library.removeTracksFromPlaylist).toHaveBeenNthCalledWith(1, 'p.1', ['i.1'], 'query');
    expect(apple.Library.removeTracksFromPlaylist).toHaveBeenNthCalledWith(2, 'p.1', ['i.1'], 'body');
    expect(named(steps, 'remove (query)')[0]).toMatchObject({ ok: false, detail: expect.stringContaining('still in the playlist') });
    expect(named(steps, 'remove (body)')[0]?.ok).toBe(true);
    expect(appleRemovalVerified).toHaveBeenCalledWith({ strategy: 'body', baseUrl: APPLE_HOSTS[0], header: APPLE_HEADERS[0] });
  });

  it('refuses to touch a song already in the playlist', async () => {
    const apple = appleFake();
    apple.Library.getAllPlaylistTracks.mockResolvedValue({ items: [entry], complete: true });
    const { deps, steps, appleRemovalVerified } = setup({}, apple);

    await runWriteProbe(deps, 'test song');

    expect(apple.Library.addTracksToPlaylist).not.toHaveBeenCalled();
    expect(apple.Library.removeTracksFromPlaylist).not.toHaveBeenCalled();
    expect(appleRemovalVerified).not.toHaveBeenCalled();
    expect(named(steps, 'test song')[0]?.ok).toBe(false);
  });

  it('keeps full blocked and tells you to remove it by hand when nothing works', async () => {
    const apple = appleFake();
    livePlaylist(apple);
    apple.Library.removeTracksFromPlaylist.mockRejectedValue(new Error('Method not allowed'));
    const { deps, steps, appleRemovalVerified } = setup({}, apple);

    await runWriteProbe(deps, 'test song');

    expect(apple.Library.removeTracksFromPlaylist).toHaveBeenCalledTimes(COMBINATIONS * 2);
    expect(named(steps, 'Apple: remove').at(-1)?.detail).toContain('Remove it by hand');
    expect(appleRemovalVerified).not.toHaveBeenCalled();
  });

  it('warns when the added song never shows up', async () => {
    const apple = appleFake();
    const { deps, steps, appleRemovalVerified } = setup({}, apple);
    await runWriteProbe(deps, 'test song');
    expect(named(steps, 'see the added song')[0]).toMatchObject({ ok: false });
    expect(apple.Library.removeTracksFromPlaylist).not.toHaveBeenCalled();
    expect(appleRemovalVerified).not.toHaveBeenCalled();
  });

  it('stops when adding fails or there is no result or connection', async () => {
    const apple = appleFake();
    apple.Library.addTracksToPlaylist.mockRejectedValue(new Error('nope'));
    const failed = setup({}, apple);
    await runWriteProbe(failed.deps, 'x');
    expect(named(failed.steps, 'add to')[0]).toMatchObject({ ok: false, detail: 'nope' });

    const empty = appleFake();
    empty.Search.search.mockResolvedValue({ results: {} } as never);
    const noResult = setup({}, empty);
    await runWriteProbe(noResult.deps, 'x');
    expect(named(noResult.steps, 'find a test song')[0]?.detail).toBe('No results');

    const broken = appleFake();
    broken.Library.getSongs.mockRejectedValue(new Error('no'));
    const noConnection = setup({}, broken);
    await runWriteProbe(noConnection.deps, 'x');
    expect(broken.Search.search).not.toHaveBeenCalled();
  });

  it('reports missing setup and unexpected failures', async () => {
    const missing = setup({ applePlaylistId: undefined });
    await runWriteProbe(missing.deps, 'x');
    expect(missing.steps[0]).toEqual({ name: 'Apple', ok: false, detail: 'No playlist chosen' });

    const noToken = setup({ appleToken: undefined });
    await runWriteProbe(noToken.deps, 'x');
    expect(noToken.steps[0]).toEqual({ name: 'Apple', ok: false, detail: 'Token not saved' });

    const apple = appleFake();
    apple.Search.search.mockRejectedValue(new Error('search down'));
    const failing = setup({}, apple);
    await runWriteProbe(failing.deps, 'x');
    expect(failing.steps.at(-2)).toEqual({ name: 'Apple', ok: false, detail: 'search down' });
  });
});

describe('runWriteProbe on YouTube', () => {
  const song = { id: 'v1', title: 'Test', artist: 'Band' };

  function live() {
    const youtube = fakeProvider('youtube', [], [song]);
    let has = false;
    youtube.add.mockImplementation(async () => {
      has = true;
    });
    youtube.remove.mockImplementation(async () => {
      has = false;
    });
    youtube.read.mockImplementation(async () => ({ tracks: has ? [song] : [], complete: true }));
    return youtube;
  }

  it('adds, removes and only then marks removing as verified', async () => {
    const youtube = live();
    const { deps, steps, youtubeRemovalVerified } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'test song');
    expect(youtube.add).toHaveBeenCalledWith(song);
    expect(youtube.remove).toHaveBeenCalledWith(song);
    expect(named(steps, 'remove from the playlist')[0]?.ok).toBe(true);
    expect(youtubeRemovalVerified).toHaveBeenCalled();
  });

  it('refuses to touch a song already in the playlist', async () => {
    const youtube = fakeProvider('youtube', [song], [song]);
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'test song');
    expect(youtube.add).not.toHaveBeenCalled();
    expect(named(steps, 'test song')[0]?.ok).toBe(false);
  });

  it('stops when the song never shows up, and does not verify when it stays', async () => {
    const neverShows = fakeProvider('youtube', [], [song]);
    const first = setup({ appleToken: undefined, youtube: neverShows.provider });
    await runWriteProbe(first.deps, 'test song');
    expect(named(first.steps, 'add to the playlist')[0]?.ok).toBe(false);
    expect(neverShows.remove).not.toHaveBeenCalled();

    const stays = live();
    stays.remove.mockImplementation(async () => {});
    const second = setup({ appleToken: undefined, youtube: stays.provider });
    await runWriteProbe(second.deps, 'test song');
    expect(named(second.steps, 'remove from the playlist')[0]?.ok).toBe(false);
    expect(second.youtubeRemovalVerified).not.toHaveBeenCalled();
  });

  it('handles a failed read, no search result and unexpected failures', async () => {
    const youtube = live();
    youtube.read.mockRejectedValueOnce(new Error('expired'));
    const first = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(first.deps, 'x');
    expect(youtube.search).not.toHaveBeenCalled();

    const empty = fakeProvider('youtube', [], []);
    const second = setup({ appleToken: undefined, youtube: empty.provider });
    await runWriteProbe(second.deps, 'x');
    expect(named(second.steps, 'find a test song')[0]?.detail).toBe('No results');

    const failing = live();
    failing.add.mockRejectedValue(new Error('add failed'));
    const third = setup({ appleToken: undefined, youtube: failing.provider });
    await runWriteProbe(third.deps, 'x');
    expect(third.steps.at(-1)).toEqual({ name: 'YouTube', ok: false, detail: 'add failed' });
  });
});
