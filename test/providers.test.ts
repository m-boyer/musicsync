import { describe, expect, it, vi } from 'vitest';
import type { AppleMusic } from '@syncfm/applemusic-api';
import { createAppleDirectory, createAppleProvider, playlistTracks } from '../src/providers/apple.js';
import { lazy } from '../src/providers/lazy.js';
import { createYouTubeDirectory, createYouTubeProvider, type YouTubeClient } from '../src/providers/youtube.js';

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

function appleFake() {
  const Library = {
    getAllPlaylistTracks: vi.fn(),
    addTracksToPlaylist: vi.fn(async () => {}),
    removeTracksFromPlaylist: vi.fn(async () => {}),
    getAllPlaylists: vi.fn(),
    createPlaylist: vi.fn(),
  };
  const Search = { search: vi.fn() };
  return { Library, Search, client: async () => ({ Library, Search }) as unknown as AppleMusic };
}

describe('Apple provider', () => {
  const entry = (id: string, catalogId?: string) => ({
    id,
    attributes: { name: 'Song', artistName: 'Band', durationInMillis: 1000, playParams: catalogId ? { catalogId } : {} },
  });

  it('reads the playlist by catalog id, once per song, and skips uploads', async () => {
    const apple = appleFake();
    apple.Library.getAllPlaylistTracks.mockResolvedValue({
      complete: true,
      items: [entry('i.1', 'c1'), entry('i.dup', 'c1'), entry('i.upload')],
    });
    const provider = createAppleProvider(apple.client, { playlistId: 'p.1', removeStrategy: null });

    expect(await provider.read()).toEqual({
      complete: true,
      tracks: [{ id: 'c1', removeId: 'i.1', title: 'Song', artist: 'Band', durationMs: 1000 }],
    });
    expect(apple.Library.getAllPlaylistTracks).toHaveBeenCalledWith('p.1');
  });

  it('passes on an incomplete read', async () => {
    const apple = appleFake();
    apple.Library.getAllPlaylistTracks.mockResolvedValue({ complete: false, items: [] });
    const provider = createAppleProvider(apple.client, { playlistId: 'p.1', removeStrategy: null });
    expect((await provider.read()).complete).toBe(false);
  });

  it('searches songs with title and artist', async () => {
    const apple = appleFake();
    apple.Search.search.mockResolvedValue({
      results: { songs: { data: [{ id: 'c1', attributes: { name: 'Song', artistName: 'Band', durationInMilliseconds: 5 } }, { id: 'c2' }] } },
    });
    const provider = createAppleProvider(apple.client, { playlistId: 'p.1', removeStrategy: null });

    const found = await provider.search(track);

    expect(apple.Search.search).toHaveBeenCalledWith(expect.objectContaining({ term: 'Song Band', limit: 5 }));
    expect(found).toEqual([
      { id: 'c1', title: 'Song', artist: 'Band', durationMs: 5 },
      { id: 'c2', title: '', artist: '' },
    ]);
    apple.Search.search.mockResolvedValue({ results: {} });
    expect(await provider.search(track)).toEqual([]);
  });

  it('adds by catalog id and removes the playlist entry with the verified strategy', async () => {
    const apple = appleFake();
    const provider = createAppleProvider(apple.client, { playlistId: 'p.1', removeStrategy: 'query' });
    await provider.add(track);
    await provider.remove({ ...track, removeId: 'i.1' });
    expect(apple.Library.addTracksToPlaylist).toHaveBeenCalledWith('p.1', ['id']);
    expect(apple.Library.removeTracksFromPlaylist).toHaveBeenCalledWith('p.1', ['i.1'], 'query');
  });

  it('refuses to remove without a verified strategy or an entry id', async () => {
    const apple = appleFake();
    const unverified = createAppleProvider(apple.client, { playlistId: 'p.1', removeStrategy: null });
    await expect(unverified.remove({ ...track, removeId: 'i.1' })).rejects.toThrow('no está verificado');
    const verified = createAppleProvider(apple.client, { playlistId: 'p.1', removeStrategy: 'body' });
    await expect(verified.remove(track)).rejects.toThrow('no Apple library id');
    expect(apple.Library.removeTracksFromPlaylist).not.toHaveBeenCalled();
  });

  it('exposes playlistTracks for direct use', () => {
    expect(playlistTracks([])).toEqual([]);
  });
});

describe('Apple directory', () => {
  it('lists only editable playlists', async () => {
    const apple = appleFake();
    apple.Library.getAllPlaylists.mockResolvedValue({
      complete: true,
      items: [
        { id: 'p.1', attributes: { name: 'Mine', canEdit: true } },
        { id: 'p.2', attributes: { name: 'Editorial', canEdit: false } },
        { id: 'p.3', attributes: { canEdit: true } },
      ],
    });
    const directory = createAppleDirectory(apple.client);

    expect(await directory.list()).toEqual([
      { id: 'p.1', name: 'Mine' },
      { id: 'p.3', name: 'p.3' },
    ]);
    expect(await directory.isEditable('p.1')).toBe(true);
    expect(await directory.isEditable('p.2')).toBe(false);
  });

  it('creates a playlist', async () => {
    const apple = appleFake();
    apple.Library.createPlaylist.mockResolvedValueOnce({ id: 'p.new', attributes: { name: 'Mix' } });
    apple.Library.createPlaylist.mockResolvedValueOnce({ id: 'p.other' });
    const directory = createAppleDirectory(apple.client);
    expect(await directory.create('Mix')).toEqual({ id: 'p.new', name: 'Mix' });
    expect(await directory.create('Typed')).toEqual({ id: 'p.other', name: 'Typed' });
  });
});

describe('YouTube', () => {
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

  function setup(loggedIn = true, accountWorks = true) {
    const client = {
      session: { logged_in: loggedIn },
      account: { getInfo: vi.fn(async () => (accountWorks ? {} : Promise.reject(new Error('Page contents not found')))) },
      music: { getPlaylist: vi.fn(), search: vi.fn() },
      getPlaylists: vi.fn(),
      getPlaylist: vi.fn(),
      playlist: { create: vi.fn(), addVideos: vi.fn(async () => ({})), removeVideos: vi.fn(async () => ({})) },
    };
    const create = async () => client as unknown as YouTubeClient;
    return { client, provider: createYouTubeProvider(create, 'PL1'), directory: createYouTubeDirectory(create) };
  }

  it('reads every page of the chosen playlist, once per song', async () => {
    const { client, provider } = setup();
    const last = { items: [{ ...songItem, id: 'v2' }, songItem], has_continuation: false, getContinuation: vi.fn() };
    client.music.getPlaylist.mockResolvedValue({ items: [songItem], has_continuation: true, getContinuation: async () => last });

    const result = await provider.read();

    expect(client.music.getPlaylist).toHaveBeenCalledWith('PL1');
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
    expect((await provider.read()).tracks).toEqual([{ id: 'omv', title: 'Official', artist: 'Band' }]);
  });

  it('reports an endless playlist as incomplete', async () => {
    const { client, provider } = setup();
    const page = { items: [], has_continuation: true, getContinuation: async () => page };
    client.music.getPlaylist.mockResolvedValue(page);
    expect((await provider.read()).complete).toBe(false);
  });

  it('fails on a session that is not signed in', async () => {
    const { provider, client } = setup(false);
    await expect(provider.read()).rejects.toThrow('no es válida');
    expect(client.account.getInfo).not.toHaveBeenCalled();
  });

  it('fails on an expired cookie that YouTube.js still marks as signed in', async () => {
    const { provider, client } = setup(true, false);
    await expect(provider.read()).rejects.toThrow('no es válida');
    expect(client.music.getPlaylist).not.toHaveBeenCalled();
  });

  it('searches songs and limits the results', async () => {
    const { client, provider } = setup();
    client.music.search.mockResolvedValue({ songs: { contents: Array.from({ length: 7 }, (_, i) => ({ ...songItem, id: `v${i}` })) } });
    expect(await provider.search(track)).toHaveLength(5);
    expect(client.music.search).toHaveBeenCalledWith('Song Band', { type: 'song' });
    client.music.search.mockResolvedValue({});
    expect(await provider.search(track)).toEqual([]);
  });

  it('adds to and removes from the chosen playlist', async () => {
    const { client, provider } = setup();
    await provider.add(track);
    await provider.remove(track);
    expect(client.playlist.addVideos).toHaveBeenCalledWith('PL1', ['id']);
    expect(client.playlist.removeVideos).toHaveBeenCalledWith('PL1', ['id']);
  });

  it('lists playlists across pages, without system lists or repeats', async () => {
    const { client, directory } = setup();
    const second = {
      playlists: [{ content_id: 'PL2', metadata: { title: { toString: () => 'Lockup' } } }, { id: 'PL1', title: 'Dup' }],
      has_continuation: false,
      getContinuation: vi.fn(),
    };
    client.getPlaylists.mockResolvedValue({
      playlists: [{ id: 'PL1', title: { toString: () => 'Grid' } }, { id: 'LM', title: 'Likes' }, { id: 'WL', title: 'Later' }, { title: 'No id' }],
      has_continuation: true,
      getContinuation: async () => second,
    });

    expect(await directory.list()).toEqual([
      { id: 'PL1', name: 'Grid' },
      { id: 'PL2', name: 'Lockup' },
    ]);
  });

  it('creates a private playlist', async () => {
    const { client, directory } = setup();
    client.playlist.create.mockResolvedValueOnce({ playlist_id: 'PLnew' });
    expect(await directory.create('Mix')).toEqual({ id: 'PLnew', name: 'Mix' });
    expect(client.playlist.create).toHaveBeenCalledWith('Mix', [], 'PRIVATE');

    client.playlist.create.mockResolvedValueOnce({});
    await expect(directory.create('Mix')).rejects.toThrow('no devolvió');
  });

  it('checks whether a playlist is editable', async () => {
    const { client, directory } = setup();
    client.getPlaylist.mockResolvedValueOnce({ info: { is_editable: true } }).mockResolvedValueOnce({ info: {} });
    expect(await directory.isEditable('PL1')).toBe(true);
    expect(await directory.isEditable('PL2')).toBe(false);
    expect(await directory.isEditable('LM')).toBe(false);
  });
});
