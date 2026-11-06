import {
  AppleMusic,
  AuthType,
  ResourceType,
  type PlaylistRemoveStrategy,
  type Region,
  type UserTokenHeader,
} from '@syncfm/applemusic-api';
import { lazy } from './lazy.js';
import type { MusicProvider, PlaylistDirectory, PlaylistInfo, ReadResult, Track } from './types.js';
import { LocalizedError } from '../i18n/index.js';

const SEARCH_LIMIT = 5;

export interface AppleOptions {
  userToken: string;
  storefront: string;
  baseURL?: string;
  userTokenHeader?: UserTokenHeader;
  maxRetries?: number;
}

export function createAppleClient(options: AppleOptions): Promise<AppleMusic> {
  const client = new AppleMusic({
    authType: AuthType.UserTokenUnofficial,
    userToken: options.userToken,
    region: options.storefront as Region,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.userTokenHeader ? { userTokenHeader: options.userTokenHeader } : {}),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
  return client.init().then(() => client);
}

interface SongLike {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    durationInMillis?: number;
    durationInMilliseconds?: number;
    playParams?: { catalogId?: string };
  };
}

function toTrack(id: string, song: SongLike): Track {
  const durationMs = song.attributes?.durationInMillis ?? song.attributes?.durationInMilliseconds;
  return {
    id,
    title: song.attributes?.name ?? '',
    artist: song.attributes?.artistName ?? '',
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

/** Playlist songs by catalog id. Uploads have no catalog id, and a repeated song counts once. */
export function playlistTracks(items: SongLike[]): Track[] {
  const tracks = new Map<string, Track>();
  for (const item of items) {
    const catalogId = item.attributes?.playParams?.catalogId;
    if (catalogId && !tracks.has(catalogId)) tracks.set(catalogId, { ...toTrack(catalogId, item), removeId: item.id });
  }
  return [...tracks.values()];
}

export interface ApplePlaylistOptions {
  playlistId: string;
  /** The way of removing songs that the connection test confirmed, if any. */
  removeStrategy: PlaylistRemoveStrategy | null;
}

export function createAppleProvider(create: () => Promise<AppleMusic>, options: ApplePlaylistOptions): MusicProvider {
  const client = lazy(create);
  return {
    service: 'apple',

    async read(): Promise<ReadResult> {
      const { items, complete } = await (await client()).Library.getAllPlaylistTracks(options.playlistId);
      return { tracks: playlistTracks(items), complete };
    },

    async search(track: Track): Promise<Track[]> {
      const { results } = await (
        await client()
      ).Search.search({
        term: `${track.title} ${track.artist}`,
        types: [ResourceType.Songs],
        limit: SEARCH_LIMIT,
      });
      const songs = (results.songs?.data ?? []) as unknown as SongLike[];
      return songs.map((song) => toTrack(song.id, song));
    },

    async add(track: Track): Promise<void> {
      await (await client()).Library.addTracksToPlaylist(options.playlistId, [track.id]);
    },

    async remove(track: Track): Promise<void> {
      if (!options.removeStrategy) throw new LocalizedError('errors.appleRemoveNotVerified');
      if (!track.removeId) throw new Error(`Song ${track.id} has no Apple library id`);
      await (await client()).Library.removeTracksFromPlaylist(options.playlistId, [track.removeId], options.removeStrategy);
    },
  };
}

export function createAppleDirectory(create: () => Promise<AppleMusic>): PlaylistDirectory {
  const client = lazy(create);
  const editable = async (): Promise<PlaylistInfo[]> => {
    const { items } = await (await client()).Library.getAllPlaylists();
    return items
      .filter((playlist) => playlist.attributes?.canEdit)
      .map((playlist) => ({ id: playlist.id, name: playlist.attributes?.name ?? playlist.id }));
  };
  return {
    list: editable,
    async create(name) {
      const playlist = await (await client()).Library.createPlaylist(name);
      return { id: playlist.id, name: playlist.attributes?.name ?? name };
    },
    async isEditable(id) {
      return (await editable()).some((playlist) => playlist.id === id);
    },
  };
}
