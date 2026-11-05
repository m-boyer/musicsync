import { describe, expect, it, vi } from 'vitest';
import type { AppleMusic } from '@syncfm/applemusic-api';
import { createAppleProvider } from '../src/providers/apple.js';
import { lazy } from '../src/providers/lazy.js';
import { createYouTubeProvider, type YouTubeClient } from '../src/providers/youtube.js';

const track = { id: 'id', title: 'Song', artist: 'Band' };

describe('lazy', () => {
  it('creates once', async () => {
    const create = vi.fn(async () => 'client');
    const get = lazy(create);
    await get();
    await get();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure', async () => {
    const create = vi.fn(async () => 'client');
    create.mockRejectedValueOnce(new Error('down'));
    const get = lazy(create);
    await expect(get()).rejects.toThrow('down');
    await expect(get()).resolves.toBe('client');
  });
});

describe('Apple provider', () => {
  function setup() {
    const Library = { getAllSongs: vi.fn(), addSongs: vi.fn(async () => {}), removeSong: vi.fn(async () => {}) };
    const Search = { search: vi.fn() };
    const provider = createAppleProvider(async () => ({ Library, Search }) as unknown as AppleMusic);
    return { provider, Library, Search };
  }

  it('reads songs by catalog id, keeps the library id and skips uploads', async () => {
    const { provider, Library } = setup();
    Library.getAllSongs.mockResolvedValue({
      complete: true,
      songs: [
        {
          id: 'i.1',
          attributes: { name: 'Song', artistName: 'Band', durationInMillis: 1000, playParams: { catalogId: 'c1' } },
        },
        { id: 'i.upload', attributes: { name: 'Mine', playParams: {} } },
      ],
    });

    expect(await provider.read()).toEqual({
      complete: true,
      tracks: [{ id: 'c1', removeId: 'i.1', title: 'Song', artist: 'Band', durationMs: 1000 }],
    });
  });

  it('passes on an incomplete read', async () => {
    const { provider, Library } = setup();
    Library.getAllSongs.mockResolvedValue({ complete: false, songs: [] });
    expect((await provider.read()).complete).toBe(false);
  });

  it('searches songs with title and artist', async () => {
    const { provider, Search } = setup();
    Search.search.mockResolvedValue({
      results: { songs: { data: [{ id: 'c1', attributes: { name: 'Song', artistName: 'Band', durationInMilliseconds: 5 } }, { id: 'c2' }] } },
    });

    const found = await provider.search(track);

    expect(Search.search).toHaveBeenCalledWith(expect.objectContaining({ term: 'Song Band', limit: 5 }));
    expect(found).toEqual([
      { id: 'c1', title: 'Song', artist: 'Band', durationMs: 5 },
      { id: 'c2', title: '', artist: '' },
    ]);
  });

  it('returns nothing when the search has no songs', async () => {
    const { provider, Search } = setup();
    Search.search.mockResolvedValue({ results: {} });
    expect(await provider.search(track)).toEqual([]);
  });

  it('adds by catalog id and removes by library id', async () => {
    const { provider, Library } = setup();
    await provider.add(track);
    await provider.remove({ ...track, removeId: 'i.1' });
    expect(Library.addSongs).toHaveBeenCalledWith(['id']);
    expect(Library.removeSong).toHaveBeenCalledWith('i.1');
  });

  it('refuses to remove a song without its library id', async () => {
    const { provider, Library } = setup();
    await expect(provider.remove(track)).rejects.toThrow('no Apple library id');
    expect(Library.removeSong).not.toHaveBeenCalled();
  });
});

describe('YouTube provider', () => {
  const omvColumns = [
    {
      title: {
        runs: [
          { endpoint: { payload: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' } } } } },
        ],
      },
    },
  ];
  const ugcColumns = JSON.parse(JSON.stringify(omvColumns).replace('OMV', 'UGC'));
  const songItem = { id: 'v1', title: 'Song', item_type: 'song', artists: [{ name: 'A' }, { name: 'B' }], duration: { seconds: 200 } };

  function setup(loggedIn = true) {
    const client = {
      session: { logged_in: loggedIn },
      music: { getPlaylist: vi.fn(), search: vi.fn() },
      interact: { like: vi.fn(async () => ({})), removeRating: vi.fn(async () => ({})) },
    };
    return { client, provider: createYouTubeProvider(async () => client as unknown as YouTubeClient) };
  }

  it('reads every page of the liked music playlist', async () => {
    const { client, provider } = setup();
    const last = { items: [{ ...songItem, id: 'v2' }], has_continuation: false, getContinuation: vi.fn() };
    client.music.getPlaylist.mockResolvedValue({
      items: [songItem],
      has_continuation: true,
      getContinuation: async () => last,
    });

    const result = await provider.read();

    expect(client.music.getPlaylist).toHaveBeenCalledWith('LM');
    expect(result.complete).toBe(true);
    expect(result.tracks.map((t) => t.id)).toEqual(['v1', 'v2']);
    expect(result.tracks[0]).toEqual({ id: 'v1', title: 'Song', artist: 'A, B', durationMs: 200_000 });
  });

  it('keeps songs and official videos, and ignores everything else', async () => {
    const { client, provider } = setup();
    client.music.getPlaylist.mockResolvedValue({
      has_continuation: false,
      getContinuation: vi.fn(),
      items: [
        { id: 'omv', title: 'Official', item_type: 'video', flex_columns: omvColumns, authors: [{ name: 'Band' }] },
        { id: 'ugc', title: 'A vlog', item_type: 'video', flex_columns: ugcColumns },
        { id: 'audio', title: 'Podcast', item_type: 'non_music_track' },
        { title: 'Continuation without id', item_type: 'song' },
        { id: 'plain', item_type: 'video' },
      ],
    });

    const { tracks } = await provider.read();

    expect(tracks).toEqual([{ id: 'omv', title: 'Official', artist: 'Band' }]);
  });

  it('reports an endless playlist as incomplete', async () => {
    const { client, provider } = setup();
    const page = { items: [], has_continuation: true, getContinuation: async () => page };
    client.music.getPlaylist.mockResolvedValue(page);
    expect((await provider.read()).complete).toBe(false);
  });

  it('fails on a session that is not signed in instead of reading no likes', async () => {
    const { provider, client } = setup(false);
    await expect(provider.read()).rejects.toThrow('not signed in');
    expect(client.music.getPlaylist).not.toHaveBeenCalled();
  });

  it('searches songs and limits the results', async () => {
    const { client, provider } = setup();
    const contents = Array.from({ length: 7 }, (_, i) => ({ ...songItem, id: `v${i}` }));
    client.music.search.mockResolvedValue({ songs: { contents } });

    const found = await provider.search(track);

    expect(client.music.search).toHaveBeenCalledWith('Song Band', { type: 'song' });
    expect(found).toHaveLength(5);
  });

  it('returns nothing when the search has no songs', async () => {
    const { client, provider } = setup();
    client.music.search.mockResolvedValue({});
    expect(await provider.search(track)).toEqual([]);
  });

  it('adds by liking and removes by clearing the rating', async () => {
    const { client, provider } = setup();
    await provider.add(track);
    await provider.remove(track);
    expect(client.interact.like).toHaveBeenCalledWith('id');
    expect(client.interact.removeRating).toHaveBeenCalledWith('id');
  });
});
