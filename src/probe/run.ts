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
    const name = `Apple: conectar con ${hostOf(connection.baseUrl)} y ${connection.header}`;
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
    name: 'Apple: leer la playlist elegida',
    ok: complete,
    detail: `${items.length} canciones${complete ? '' : ', lectura incompleta'}`,
  });
}

async function probeYouTubeRead(deps: ProbeDeps, youtube: MusicProvider): Promise<boolean> {
  try {
    const { tracks, complete } = await youtube.read();
    await deps.report({
      name: 'YouTube: leer la playlist elegida',
      ok: complete,
      detail: `${tracks.length} canciones${complete ? '' : ', lectura incompleta'}`,
    });
    return complete;
  } catch (error) {
    await deps.report({ name: 'YouTube: leer la playlist elegida', ok: false, detail: safeError(error).message });
    return false;
  }
}

async function reportMissing(deps: ProbeDeps): Promise<{ apple?: string; youtube?: string }> {
  const missing: { apple?: string; youtube?: string } = {};
  if (!deps.appleToken) missing.apple = 'Falta cargar el token';
  else if (!deps.applePlaylistId) missing.apple = 'Falta elegir la playlist';
  if (!deps.youtube) missing.youtube = deps.youtubeMissing ?? 'Falta cargar la cookie';
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
        await deps.report({ name: 'Apple: leer la playlist elegida', ok: false, detail: safeError(error).message });
      }
    } else if (!deps.applePlaylistId) {
      await deps.report({ name: 'Apple: playlist', ok: false, detail: 'Falta elegir la playlist' });
    }
  } else {
    await deps.report({ name: 'Apple', ok: false, detail: 'Falta cargar el token' });
  }

  if (deps.youtube) await probeYouTubeRead(deps, deps.youtube);
  else await deps.report({ name: 'YouTube', ok: false, detail: deps.youtubeMissing ?? 'Falta cargar la cookie' });
}

async function probeAppleWrite(deps: ProbeDeps, token: string, playlistId: string, query: string): Promise<void> {
  const connections = await findAppleConnections(deps, token);
  const first = connections[0];
  if (!first) return;

  const finder = await clientFor(deps, token, first);
  const { results } = await finder.Search.search({ term: query, types: [ResourceType.Songs], limit: 1 });
  const song = results.songs?.data?.[0] as { id: string; attributes?: { name?: string } } | undefined;
  if (!song) {
    await deps.report({ name: 'Apple: buscar canción de prueba', ok: false, detail: 'Sin resultados' });
    return;
  }
  const label = song.attributes?.name ?? song.id;

  const findEntry = async (connection: Connection) =>
    (await (await clientFor(deps, token, connection)).Library.getAllPlaylistTracks(playlistId)).items.find(
      (item) => item.attributes?.playParams?.catalogId === song.id,
    );

  if (await findEntry(first)) {
    await deps.report({
      name: 'Apple: canción de prueba',
      ok: false,
      detail: 'Ya está en la playlist, así que no la toco. Elegí otra.',
    });
    return;
  }
  await deps.report({ name: 'Apple: canción de prueba', ok: true, detail: label });

  try {
    await (await clientFor(deps, token, first)).Library.addTracksToPlaylist(playlistId, [song.id]);
    await deps.report({ name: 'Apple: agregar a la playlist', ok: true });
  } catch (error) {
    await deps.report({ name: 'Apple: agregar a la playlist', ok: false, detail: safeError(error).message });
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
      name: 'Apple: ver la canción agregada',
      ok: false,
      detail: `No apareció en la playlist. Si aparece más tarde, quitá "${label}" a mano.`,
    });
    return;
  }

  for (const connection of connections) {
    for (const strategy of PLAYLIST_REMOVE_STRATEGIES) {
      const name = `Apple: quitar (${strategy}) con ${hostOf(connection.baseUrl)} y ${connection.header}`;
      try {
        await (await clientFor(deps, token, connection)).Library.removeTracksFromPlaylist(playlistId, [entry.id], strategy);
      } catch (error) {
        await deps.report({ name, ok: false, detail: safeError(error).message });
        continue;
      }
      const gone = await waitFor(async () => (await findEntry(connection)) === undefined, waitMs);
      await deps.report({ name, ok: gone, ...(gone ? {} : { detail: 'Respondió bien pero la canción sigue en la playlist' }) });
      if (gone) {
        await deps.appleRemovalVerified?.({ strategy, ...connection });
        return;
      }
    }
  }

  await deps.report({
    name: 'Apple: quitar',
    ok: false,
    detail: `Ninguna forma pudo quitar "${label}" de la playlist. Quitala a mano. El modo full va a seguir bloqueado.`,
  });
}

async function probeYouTubeWrite(deps: ProbeDeps, youtube: MusicProvider, query: string): Promise<void> {
  if (!(await probeYouTubeRead(deps, youtube))) return;

  const [song] = await youtube.search({ id: '', title: query, artist: '' });
  if (!song) {
    await deps.report({ name: 'YouTube: buscar canción de prueba', ok: false, detail: 'Sin resultados' });
    return;
  }

  const inPlaylist = async () => (await youtube.read()).tracks.some((track) => track.id === song.id);
  if (await inPlaylist()) {
    await deps.report({
      name: 'YouTube: canción de prueba',
      ok: false,
      detail: 'Ya está en la playlist, así que no la toco. Elegí otra.',
    });
    return;
  }
  await deps.report({ name: 'YouTube: canción de prueba', ok: true, detail: song.title });

  const waitMs = deps.waitMs ?? POLL_INTERVAL_MS;
  await youtube.add(song);
  const added = await waitFor(inPlaylist, waitMs);
  await deps.report({
    name: 'YouTube: agregar a la playlist',
    ok: added,
    ...(added ? {} : { detail: `No apareció en la playlist. Si aparece más tarde, quitá "${song.title}" a mano.` }),
  });
  if (!added) return;

  await youtube.remove(song);
  const gone = await waitFor(async () => !(await inPlaylist()), waitMs);
  await deps.report({
    name: 'YouTube: quitar de la playlist',
    ok: gone,
    ...(gone ? {} : { detail: `Sigue en la playlist: "${song.title}". Quitala a mano.` }),
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
    await deps.report({ name: 'YouTube', ok: false, detail: missing.youtube ?? 'Falta cargar la cookie' });
  }
}
