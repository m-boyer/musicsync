import { Innertube } from 'youtubei.js';
import { lazy } from './lazy.js';
import type { MusicProvider, PlaylistDirectory, PlaylistInfo, ReadResult, Track } from './types.js';

const MAX_PAGES = 1000;
const MAX_PLAYLIST_LIST_PAGES = 20;
const SEARCH_LIMIT = 5;
/** System lists that are not playlists you can sync into: likes, watch later, liked videos. */
const SYSTEM_PLAYLISTS = new Set(['LM', 'WL', 'LL']);

interface ItemLike {
  id?: string;
  title?: string;
  item_type?: string;
  duration?: { seconds: number };
  artists?: { name: string }[];
  authors?: { name: string }[];
  flex_columns?: unknown;
}

interface PageLike {
  items: readonly unknown[];
  has_continuation: boolean;
  getContinuation(): Promise<PageLike>;
}

interface PlaylistFeedLike {
  playlists: readonly unknown[];
  has_continuation: boolean;
  getContinuation(): Promise<PlaylistFeedLike>;
}

/** The parts of YouTube.js the provider uses. */
export interface YouTubeClient {
  session: { logged_in: boolean };
  account: { getInfo(): Promise<unknown> };
  music: {
    getPlaylist(id: string): Promise<PageLike>;
    search(query: string, filters: { type: 'song' }): Promise<{ songs?: { contents?: readonly unknown[] } | undefined }>;
  };
  getPlaylists(): Promise<PlaylistFeedLike>;
  getPlaylist(id: string): Promise<{ info: { is_editable?: boolean } }>;
  playlist: {
    create(title: string, videoIds: string[], privacy?: 'PRIVATE'): Promise<{ playlist_id?: string }>;
    addVideos(playlistId: string, videoIds: string[]): Promise<unknown>;
    removeVideos(playlistId: string, videoIds: string[]): Promise<unknown>;
  };
}

export async function createYouTubeClient(cookie: string): Promise<YouTubeClient> {
  return (await Innertube.create({ cookie, retrieve_player: false })) as unknown as YouTubeClient;
}

function musicVideoType(item: ItemLike): string | undefined {
  const columns = item.flex_columns as
    | { title?: { runs?: { endpoint?: { payload?: Record<string, any> } }[] } }[]
    | undefined;
  return columns?.[0]?.title?.runs?.[0]?.endpoint?.payload?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig
    ?.musicVideoType;
}

/** Keeps songs and official music videos only. */
function isMusic(item: ItemLike): boolean {
  if (item.item_type === 'song') return true;
  return item.item_type === 'video' && musicVideoType(item) === 'MUSIC_VIDEO_TYPE_OMV';
}

function toTrack(item: ItemLike): Track | undefined {
  if (!item.id || !item.title || !isMusic(item)) return undefined;
  const people = item.artists ?? item.authors ?? [];
  const seconds = item.duration?.seconds;
  return {
    id: item.id,
    title: item.title,
    artist: people.map((person) => person.name).join(', '),
    ...(seconds ? { durationMs: seconds * 1000 } : {}),
  };
}

function toTracks(items: readonly unknown[]): Track[] {
  return items.map((item) => toTrack(item as ItemLike)).filter((track): track is Track => track !== undefined);
}

/** Creates the client once and proves the session is real before any use. */
export function signedInClient(create: () => Promise<YouTubeClient>): () => Promise<YouTubeClient> {
  return lazy(async () => {
    const created = await create();
    // YouTube.js marks any cookie as signed in, and an expired one reads as an empty list.
    // Reading the account fails instead, so it proves the session is real.
    const signedIn =
      created.session.logged_in &&
      (await created.account.getInfo().then(
        () => true,
        () => false,
      ));
    if (!signedIn) throw new Error('La sesión de YouTube no es válida: cargá la cookie de nuevo');
    return created;
  });
}

export function createYouTubeProvider(create: () => Promise<YouTubeClient>, playlistId: string): MusicProvider {
  const client = signedInClient(create);

  return {
    service: 'youtube',

    async read(): Promise<ReadResult> {
      let page = await (await client()).music.getPlaylist(playlistId);
      const tracks = new Map<string, Track>();
      const collect = (items: readonly unknown[]) => {
        for (const track of toTracks(items)) if (!tracks.has(track.id)) tracks.set(track.id, track);
      };
      collect(page.items);
      let pages = 1;
      while (page.has_continuation && pages < MAX_PAGES) {
        page = await page.getContinuation();
        collect(page.items);
        pages += 1;
      }
      return { tracks: [...tracks.values()], complete: !page.has_continuation };
    },

    async search(track: Track): Promise<Track[]> {
      const results = await (await client()).music.search(`${track.title} ${track.artist}`, { type: 'song' });
      return toTracks(results.songs?.contents ?? []).slice(0, SEARCH_LIMIT);
    },

    async add(track: Track): Promise<void> {
      await (await client()).playlist.addVideos(playlistId, [track.id]);
    },

    async remove(track: Track): Promise<void> {
      await (await client()).playlist.removeVideos(playlistId, [track.id]);
    },
  };
}

interface PlaylistItemLike {
  id?: string;
  content_id?: string;
  title?: { toString(): string } | string;
  metadata?: { title?: { toString(): string } } | null;
}

function toPlaylistInfo(item: PlaylistItemLike): PlaylistInfo | undefined {
  const id = item.id ?? item.content_id;
  const name = (item.title ?? item.metadata?.title)?.toString();
  if (!id || !name || SYSTEM_PLAYLISTS.has(id)) return undefined;
  return { id, name };
}

export function createYouTubeDirectory(create: () => Promise<YouTubeClient>): PlaylistDirectory {
  const client = signedInClient(create);
  return {
    async list() {
      let feed = await (await client()).getPlaylists();
      const playlists = new Map<string, PlaylistInfo>();
      const collect = (items: readonly unknown[]) => {
        for (const item of items) {
          const info = toPlaylistInfo(item as PlaylistItemLike);
          if (info && !playlists.has(info.id)) playlists.set(info.id, info);
        }
      };
      collect(feed.playlists);
      for (let pages = 1; feed.has_continuation && pages < MAX_PLAYLIST_LIST_PAGES; pages += 1) {
        feed = await feed.getContinuation();
        collect(feed.playlists);
      }
      return [...playlists.values()];
    },
    async create(name) {
      const { playlist_id: id } = await (await client()).playlist.create(name, [], 'PRIVATE');
      if (!id) throw new Error('YouTube no devolvió la playlist creada');
      return { id, name };
    },
    async isEditable(id) {
      if (SYSTEM_PLAYLISTS.has(id)) return false;
      return (await (await client()).getPlaylist(id)).info.is_editable === true;
    },
  };
}
