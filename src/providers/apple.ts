import { AppleMusic, AuthType, ResourceType, type Region, type UserTokenHeader } from '@syncfm/applemusic-api';
import { lazy } from './lazy.js';
import type { MusicProvider, ReadResult, Track } from './types.js';

const SEARCH_LIMIT = 5;

export interface AppleOptions {
  userToken: string;
  storefront: string;
  baseURL?: string;
  userTokenHeader?: UserTokenHeader;
}

export function createAppleClient(options: AppleOptions): Promise<AppleMusic> {
  const client = new AppleMusic({
    authType: AuthType.UserTokenUnofficial,
    userToken: options.userToken,
    region: options.storefront as Region,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    ...(options.userTokenHeader ? { userTokenHeader: options.userTokenHeader } : {}),
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

export function createAppleProvider(create: () => Promise<AppleMusic>): MusicProvider {
  const client = lazy(create);
  return {
    service: 'apple',

    async read(): Promise<ReadResult> {
      const { songs, complete } = await (await client()).Library.getAllSongs();
      const tracks: Track[] = [];
      for (const song of songs) {
        // Uploads have no catalog id, so they have no equivalent to sync.
        const catalogId = song.attributes?.playParams?.catalogId;
        if (catalogId) tracks.push({ ...toTrack(catalogId, song), removeId: song.id });
      }
      return { tracks, complete };
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
      await (await client()).Library.addSongs([track.id]);
    },

    async remove(track: Track): Promise<void> {
      if (!track.removeId) throw new Error(`Song ${track.id} has no Apple library id`);
      await (await client()).Library.removeSong(track.removeId);
    },
  };
}
