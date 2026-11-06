import type { AppleMusic, PlaylistRemoveStrategy } from '@syncfm/applemusic-api';
import { PLAYLIST_REMOVE_STRATEGIES, ResourceType } from '@syncfm/applemusic-api';
import type { AppleOptions } from '../providers/apple.js';
import type { MusicProvider } from '../providers/types.js';
import type { ProbeStep } from '../repos/probes.js';
import type { AppleUserTokenHeader } from '../repos/settings.js';
import { errorMessage } from '../sync/cycle.js';
import { message as m, type Message } from '../i18n/index.js';

export const APPLE_HOSTS = ['https://amp-api.music.apple.com', 'https://amp-api-edge.music.apple.com'];
export const APPLE_HEADERS: AppleUserTokenHeader[] = ['Music-User-Token', 'media-user-token'];

const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 10_000;

export interface AppleRemoval {
  strategy: PlaylistRemoveStrategy;
  baseUrl: string;
  header: AppleUserTokenHeader;
}

export interface ProbeDeps {
  appleToken: string | undefined;
  applePlaylistId: string | undefined;
  storefront: string;
  /** The saved connection is tried first. */
  preferredConnection?: { baseUrl: string | null; header: AppleUserTokenHeader };
  createAppleClient(options: AppleOptions): Promise<AppleMusic>;
  /** Bound to the chosen YouTube playlist, or undefined when something is missing. */
  youtube: MusicProvider | undefined;
  youtubeMissing?: Message;
  report(step: ProbeStep): Promise<void>;
  appleRemovalVerified?(removal: AppleRemoval): Promise<void>;
  youtubeRemovalVerified?(): Promise<void>;
  waitMs?: number;
}

type Connection = { baseUrl: string; header: AppleUserTokenHeader };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, waitMs: number): Promise<boolean> {
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    if (await check()) return true;
    await delay(waitMs);
  }
  return false;
}

function songCount(count: number, complete: boolean): Message {
  return m(complete ? 'probe.readCount' : 'probe.readIncomplete', { count });
}

function hostOf(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

function orderedConnections(preferred: ProbeDeps['preferredConnection']): Connection[] {
  const all = APPLE_HOSTS.flatMap((baseUrl) => APPLE_HEADERS.map((header) => ({ baseUrl, header })));
  const first = all.findIndex((c) => c.baseUrl === preferred?.baseUrl && c.header === preferred?.header);
  return first > 0 ? [all[first]!, ...all.filter((_, i) => i !== first)] : all;
}

function clientFor(deps: ProbeDeps, token: string, connection: Connection): Promise<AppleMusic> {
  // Clients share one configuration, so each use applies its combination again.
  return deps.createAppleClient({
    userToken: token,
    storefront: deps.storefront,
    baseURL: connection.baseUrl,
    userTokenHeader: connection.header,
    maxRetries: 0,
  });
}

async function findAppleConnections(deps: ProbeDeps, token: string): Promise<Connection[]> {
  const working: Connection[] = [];
  for (const connection of orderedConnections(deps.preferredConnection)) {
    const name = m('probe.connect', { host: hostOf(connection.baseUrl), header: connection.header });
    try {
      const client = await clientFor(deps, token, connection);
      await client.Library.getSongs(1, 0);
      working.push(connection);
      await deps.report({ name, ok: true, connection });
    } catch (error) {
      await deps.report({ name, ok: false, detail: errorMessage(error) });
    }
  }
  return working;
}

async function readApplePlaylist(deps: ProbeDeps, token: string, connection: Connection, playlistId: string) {
  const client = await clientFor(deps, token, connection);
  const { items, complete } = await client.Library.getAllPlaylistTracks(playlistId);
  await deps.report({ name: m('probe.appleRead'), ok: complete, detail: songCount(items.length, complete) });
}

async function probeYouTubeRead(deps: ProbeDeps, youtube: MusicProvider): Promise<boolean> {
  try {
    const { tracks, complete } = await youtube.read();
    await deps.report({ name: m('probe.youtubeRead'), ok: complete, detail: songCount(tracks.length, complete) });
    return complete;
  } catch (error) {
    await deps.report({ name: m('probe.youtubeRead'), ok: false, detail: errorMessage(error) });
    return false;
  }
}

async function reportMissing(deps: ProbeDeps): Promise<{ apple?: Message; youtube?: Message }> {
  const missing: { apple?: Message; youtube?: Message } = {};
  if (!deps.appleToken) missing.apple = m('probe.noToken');
  else if (!deps.applePlaylistId) missing.apple = m('probe.noPlaylist');
  if (!deps.youtube) missing.youtube = deps.youtubeMissing ?? m('probe.noCookie');
  if (missing.apple) await deps.report({ name: 'Apple', ok: false, detail: missing.apple });
  return missing;
}

/** Only reads. Reports which Apple connection works and reads both chosen playlists. */
export async function runReadProbe(deps: ProbeDeps): Promise<void> {
  if (deps.appleToken) {
    const token = deps.appleToken;
    const connections = await findAppleConnections(deps, token);
    const first = connections[0];
    if (first && deps.applePlaylistId) {
      try {
        await readApplePlaylist(deps, token, first, deps.applePlaylistId);
      } catch (error) {
        await deps.report({ name: m('probe.appleRead'), ok: false, detail: errorMessage(error) });
      }
    } else if (!deps.applePlaylistId) {
      await deps.report({ name: m('probe.applePlaylist'), ok: false, detail: m('probe.noPlaylist') });
    }
  } else {
    await deps.report({ name: 'Apple', ok: false, detail: m('probe.noToken') });
  }

  if (deps.youtube) await probeYouTubeRead(deps, deps.youtube);
  else await deps.report({ name: 'YouTube', ok: false, detail: deps.youtubeMissing ?? m('probe.noCookie') });
}

async function probeAppleWrite(deps: ProbeDeps, token: string, playlistId: string, query: string): Promise<void> {
  const connections = await findAppleConnections(deps, token);
  const first = connections[0];
  if (!first) return;

  const finder = await clientFor(deps, token, first);
  const { results } = await finder.Search.search({ term: query, types: [ResourceType.Songs], limit: 1 });
  const song = results.songs?.data?.[0] as { id: string; attributes?: { name?: string } } | undefined;
  if (!song) {
    await deps.report({ name: m('probe.appleFind'), ok: false, detail: m('probe.noResults') });
    return;
  }
  const label = song.attributes?.name ?? song.id;

  const findEntry = async (connection: Connection) =>
    (await (await clientFor(deps, token, connection)).Library.getAllPlaylistTracks(playlistId)).items.find(
      (item) => item.attributes?.playParams?.catalogId === song.id,
    );

  if (await findEntry(first)) {
    await deps.report({
      name: m('probe.appleSong'),
      ok: false,
      detail: m('probe.alreadyThere'),
    });
    return;
  }
  await deps.report({ name: m('probe.appleSong'), ok: true, detail: label });

  try {
    await (await clientFor(deps, token, first)).Library.addTracksToPlaylist(playlistId, [song.id]);
    await deps.report({ name: m('probe.appleAdd'), ok: true });
  } catch (error) {
    await deps.report({ name: m('probe.appleAdd'), ok: false, detail: errorMessage(error) });
    return;
  }

  const waitMs = deps.waitMs ?? POLL_INTERVAL_MS;
  let entry: Awaited<ReturnType<typeof findEntry>>;
  await waitFor(async () => {
    entry = await findEntry(first);
    return entry !== undefined;
  }, waitMs);
  if (!entry) {
    await deps.report({
      name: m('probe.appleSeen'),
      ok: false,
      detail: m('probe.notShown', { song: label }),
    });
    return;
  }

  for (const connection of connections) {
    for (const strategy of PLAYLIST_REMOVE_STRATEGIES) {
      const name = m('probe.appleRemoveWith', { strategy, host: hostOf(connection.baseUrl), header: connection.header });
      try {
        await (await clientFor(deps, token, connection)).Library.removeTracksFromPlaylist(playlistId, [entry.id], strategy);
      } catch (error) {
        await deps.report({ name, ok: false, detail: errorMessage(error) });
        continue;
      }
      const gone = await waitFor(async () => (await findEntry(connection)) === undefined, waitMs);
      await deps.report({ name, ok: gone, ...(gone ? {} : { detail: m('probe.stillThere') }) });
      if (gone) {
        await deps.appleRemovalVerified?.({ strategy, ...connection });
        return;
      }
    }
  }

  await deps.report({
    name: m('probe.appleRemove'),
    ok: false,
    detail: m('probe.appleRemoveFailed', { song: label }),
  });
}

async function probeYouTubeWrite(deps: ProbeDeps, youtube: MusicProvider, query: string): Promise<void> {
  if (!(await probeYouTubeRead(deps, youtube))) return;

  const [song] = await youtube.search({ id: '', title: query, artist: '' });
  if (!song) {
    await deps.report({ name: m('probe.youtubeFind'), ok: false, detail: m('probe.noResults') });
    return;
  }

  const inPlaylist = async () => (await youtube.read()).tracks.some((track) => track.id === song.id);
  if (await inPlaylist()) {
    await deps.report({
      name: m('probe.youtubeSong'),
      ok: false,
      detail: m('probe.alreadyThere'),
    });
    return;
  }
  await deps.report({ name: m('probe.youtubeSong'), ok: true, detail: song.title });

  const waitMs = deps.waitMs ?? POLL_INTERVAL_MS;
  await youtube.add(song);
  const added = await waitFor(inPlaylist, waitMs);
  await deps.report({
    name: m('probe.youtubeAdd'),
    ok: added,
    ...(added ? {} : { detail: m('probe.notShown', { song: song.title }) }),
  });
  if (!added) return;

  await youtube.remove(song);
  const gone = await waitFor(async () => !(await inPlaylist()), waitMs);
  await deps.report({
    name: m('probe.youtubeRemove'),
    ok: gone,
    ...(gone ? {} : { detail: m('probe.youtubeStillThere', { song: song.title }) }),
  });
  if (gone) await deps.youtubeRemovalVerified?.();
}

/**
 * Adds and removes one song found with the query on each chosen playlist. It refuses to touch a
 * song already there, and only marks removing as verified after confirming the song is gone.
 */
export async function runWriteProbe(deps: ProbeDeps, query: string): Promise<void> {
  const guarded = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      await deps.report({ name, ok: false, detail: errorMessage(error) });
    }
  };

  const missing = await reportMissing(deps);
  if (!missing.apple && deps.appleToken && deps.applePlaylistId) {
    const token = deps.appleToken;
    const playlistId = deps.applePlaylistId;
    await guarded('Apple', () => probeAppleWrite(deps, token, playlistId, query));
  }

  if (deps.youtube) {
    const youtube = deps.youtube;
    await guarded('YouTube', () => probeYouTubeWrite(deps, youtube, query));
  } else {
    await deps.report({ name: 'YouTube', ok: false, detail: missing.youtube ?? m('probe.noCookie') });
  }
}
