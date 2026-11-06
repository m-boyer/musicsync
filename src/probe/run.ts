import type { AppleMusic, PlaylistRemoveStrategy } from '@syncfm/applemusic-api';
import { PLAYLIST_REMOVE_STRATEGIES, ResourceType } from '@syncfm/applemusic-api';
import type { AppleOptions } from '../providers/apple.js';
import type { MusicProvider } from '../providers/types.js';
import type { ProbeStep } from '../repos/probes.js';
import type { AppleUserTokenHeader } from '../repos/settings.js';
import { safeError } from '../sync/cycle.js';

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
  youtubeMissing?: string;
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
    const name = `Apple: connect with ${hostOf(connection.baseUrl)} and ${connection.header}`;
    try {
      const client = await clientFor(deps, token, connection);
      await client.Library.getSongs(1, 0);
      working.push(connection);
      await deps.report({ name, ok: true, connection });
    } catch (error) {
      await deps.report({ name, ok: false, detail: safeError(error).message });
    }
  }
  return working;
}

async function readApplePlaylist(deps: ProbeDeps, token: string, connection: Connection, playlistId: string) {
  const client = await clientFor(deps, token, connection);
  const { items, complete } = await client.Library.getAllPlaylistTracks(playlistId);
  await deps.report({
    name: 'Apple: read the chosen playlist',
    ok: complete,
    detail: `${items.length} songs${complete ? '' : ', incomplete read'}`,
  });
}

async function probeYouTubeRead(deps: ProbeDeps, youtube: MusicProvider): Promise<boolean> {
  try {
    const { tracks, complete } = await youtube.read();
    await deps.report({
      name: 'YouTube: read the chosen playlist',
      ok: complete,
      detail: `${tracks.length} songs${complete ? '' : ', incomplete read'}`,
    });
    return complete;
  } catch (error) {
    await deps.report({ name: 'YouTube: read the chosen playlist', ok: false, detail: safeError(error).message });
    return false;
  }
}

async function reportMissing(deps: ProbeDeps): Promise<{ apple?: string; youtube?: string }> {
  const missing: { apple?: string; youtube?: string } = {};
  if (!deps.appleToken) missing.apple = 'Token not saved';
  else if (!deps.applePlaylistId) missing.apple = 'No playlist chosen';
  if (!deps.youtube) missing.youtube = deps.youtubeMissing ?? 'Cookie not saved';
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
        await deps.report({ name: 'Apple: read the chosen playlist', ok: false, detail: safeError(error).message });
      }
    } else if (!deps.applePlaylistId) {
      await deps.report({ name: 'Apple: playlist', ok: false, detail: 'No playlist chosen' });
    }
  } else {
    await deps.report({ name: 'Apple', ok: false, detail: 'Token not saved' });
  }

  if (deps.youtube) await probeYouTubeRead(deps, deps.youtube);
  else await deps.report({ name: 'YouTube', ok: false, detail: deps.youtubeMissing ?? 'Cookie not saved' });
}

async function probeAppleWrite(deps: ProbeDeps, token: string, playlistId: string, query: string): Promise<void> {
  const connections = await findAppleConnections(deps, token);
  const first = connections[0];
  if (!first) return;

  const finder = await clientFor(deps, token, first);
  const { results } = await finder.Search.search({ term: query, types: [ResourceType.Songs], limit: 1 });
  const song = results.songs?.data?.[0] as { id: string; attributes?: { name?: string } } | undefined;
  if (!song) {
    await deps.report({ name: 'Apple: find a test song', ok: false, detail: 'No results' });
    return;
  }
  const label = song.attributes?.name ?? song.id;

  const findEntry = async (connection: Connection) =>
    (await (await clientFor(deps, token, connection)).Library.getAllPlaylistTracks(playlistId)).items.find(
      (item) => item.attributes?.playParams?.catalogId === song.id,
    );

  if (await findEntry(first)) {
    await deps.report({
      name: 'Apple: test song',
      ok: false,
      detail: 'It is already in the playlist, so it is left alone. Pick another one.',
    });
    return;
  }
  await deps.report({ name: 'Apple: test song', ok: true, detail: label });

  try {
    await (await clientFor(deps, token, first)).Library.addTracksToPlaylist(playlistId, [song.id]);
    await deps.report({ name: 'Apple: add to the playlist', ok: true });
  } catch (error) {
    await deps.report({ name: 'Apple: add to the playlist', ok: false, detail: safeError(error).message });
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
      name: 'Apple: see the added song',
      ok: false,
      detail: `It did not show up in the playlist. If it shows up later, remove "${label}" by hand.`,
    });
    return;
  }

  for (const connection of connections) {
    for (const strategy of PLAYLIST_REMOVE_STRATEGIES) {
      const name = `Apple: remove (${strategy}) with ${hostOf(connection.baseUrl)} and ${connection.header}`;
      try {
        await (await clientFor(deps, token, connection)).Library.removeTracksFromPlaylist(playlistId, [entry.id], strategy);
      } catch (error) {
        await deps.report({ name, ok: false, detail: safeError(error).message });
        continue;
      }
      const gone = await waitFor(async () => (await findEntry(connection)) === undefined, waitMs);
      await deps.report({ name, ok: gone, ...(gone ? {} : { detail: 'The request succeeded but the song is still in the playlist' }) });
      if (gone) {
        await deps.appleRemovalVerified?.({ strategy, ...connection });
        return;
      }
    }
  }

  await deps.report({
    name: 'Apple: remove',
    ok: false,
    detail: `No method could remove "${label}" from the playlist. Remove it by hand. Full mode stays blocked.`,
  });
}

async function probeYouTubeWrite(deps: ProbeDeps, youtube: MusicProvider, query: string): Promise<void> {
  if (!(await probeYouTubeRead(deps, youtube))) return;

  const [song] = await youtube.search({ id: '', title: query, artist: '' });
  if (!song) {
    await deps.report({ name: 'YouTube: find a test song', ok: false, detail: 'No results' });
    return;
  }

  const inPlaylist = async () => (await youtube.read()).tracks.some((track) => track.id === song.id);
  if (await inPlaylist()) {
    await deps.report({
      name: 'YouTube: test song',
      ok: false,
      detail: 'It is already in the playlist, so it is left alone. Pick another one.',
    });
    return;
  }
  await deps.report({ name: 'YouTube: test song', ok: true, detail: song.title });

  const waitMs = deps.waitMs ?? POLL_INTERVAL_MS;
  await youtube.add(song);
  const added = await waitFor(inPlaylist, waitMs);
  await deps.report({
    name: 'YouTube: add to the playlist',
    ok: added,
    ...(added ? {} : { detail: `It did not show up in the playlist. If it shows up later, remove "${song.title}" by hand.` }),
  });
  if (!added) return;

  await youtube.remove(song);
  const gone = await waitFor(async () => !(await inPlaylist()), waitMs);
  await deps.report({
    name: 'YouTube: remove from the playlist',
    ok: gone,
    ...(gone ? {} : { detail: `Still in the playlist: "${song.title}". Remove it by hand.` }),
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
      await deps.report({ name, ok: false, detail: safeError(error).message });
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
    await deps.report({ name: 'YouTube', ok: false, detail: missing.youtube ?? 'Cookie not saved' });
  }
}
