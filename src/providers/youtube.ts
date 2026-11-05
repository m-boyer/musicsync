import { Innertube } from 'youtubei.js';
import { lazy } from './lazy.js';
import type { MusicProvider, ReadResult, Track } from './types.js';

const LIKED_MUSIC_PLAYLIST = 'LM';
const MAX_PAGES = 1000;
const SEARCH_LIMIT = 5;

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

/** The parts of YouTube.js the provider uses. */
export interface YouTubeClient {
  session: { logged_in: boolean };
  account: { getInfo(): Promise<unknown> };
  music: {
    getPlaylist(id: string): Promise<PageLike>;
    search(query: string, filters: { type: 'song' }): Promise<{ songs?: { contents?: readonly unknown[] } | undefined }>;
  };
  interact: {
    like(id: string): Promise<unknown>;
    removeRating(id: string): Promise<unknown>;
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

/** Likes can include any YouTube video: keeps songs and official music videos only. */
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

export function createYouTubeProvider(create: () => Promise<YouTubeClient>): MusicProvider {
  const client = lazy(async () => {
    const created = await create();
    // YouTube.js marks any cookie as signed in, and an expired one reads as an account with no
    // likes. Reading the account fails instead, so it proves the session is real.
    const signedIn =
      created.session.logged_in &&
      (await created.account.getInfo().then(
        () => true,
        () => false,
      ));
    if (!signedIn) throw new Error('La sesión de YouTube no es válida: cargá la cookie de nuevo');
    return created;
  });

  return {
    service: 'youtube',

    async read(): Promise<ReadResult> {
      let page = await (await client()).music.getPlaylist(LIKED_MUSIC_PLAYLIST);
      const tracks = toTracks(page.items);
      let pages = 1;
      while (page.has_continuation && pages < MAX_PAGES) {
        page = await page.getContinuation();
        tracks.push(...toTracks(page.items));
        pages += 1;
      }
      return { tracks, complete: !page.has_continuation };
    },

    async search(track: Track): Promise<Track[]> {
      const results = await (await client()).music.search(`${track.title} ${track.artist}`, { type: 'song' });
      return toTracks(results.songs?.contents ?? []).slice(0, SEARCH_LIMIT);
    },

    async add(track: Track): Promise<void> {
      await (await client()).interact.like(track.id);
    },

    async remove(track: Track): Promise<void> {
      await (await client()).interact.removeRating(track.id);
    },
  };
}
