import type { AppleMusic } from '@syncfm/applemusic-api';
import { ResourceType } from '@syncfm/applemusic-api';
import type { AppleOptions } from '../providers/apple.js';
import type { MusicProvider, Service } from '../providers/types.js';
import type { ProbeStep } from '../repos/probes.js';
import type { AppleUserTokenHeader } from '../repos/settings.js';
import { safeError } from '../sync/cycle.js';

export const APPLE_HOSTS = ['https://amp-api.music.apple.com', 'https://amp-api-edge.music.apple.com'];
export const APPLE_HEADERS: AppleUserTokenHeader[] = ['Music-User-Token', 'media-user-token'];

const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 10_000;

export interface ProbeDeps {
  appleToken: string | undefined;
  storefront: string;
  createAppleClient(options: AppleOptions): Promise<AppleMusic>;
  youtube: MusicProvider | undefined;
  report(step: ProbeStep): Promise<void>;
  markDeleteVerified?(service: Service): Promise<void>;
  waitMs?: number;
}

type Connection = { client: AppleMusic; baseUrl: string; header: AppleUserTokenHeader };

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

async function findAppleConnections(deps: ProbeDeps, token: string): Promise<Connection[]> {
  const working: Connection[] = [];
  for (const baseUrl of APPLE_HOSTS) {
    for (const header of APPLE_HEADERS) {
      const name = `Apple: leer con ${new URL(baseUrl).hostname} y ${header}`;
      try {
        const client = await deps.createAppleClient({
          userToken: token,
          storefront: deps.storefront,
          baseURL: baseUrl,
          userTokenHeader: header,
          maxRetries: 0,
        });
        const page = await client.Library.getSongs(1, 0);
        working.push({ client, baseUrl, header });
        await deps.report({
          name,
          ok: true,
          detail: `${page.meta?.total ?? '?'} canciones`,
          connection: { baseUrl, header },
        });
      } catch (error) {
        await deps.report({ name, ok: false, detail: safeError(error).message });
      }
    }
  }
  return working;
}

async function probeYouTubeRead(deps: ProbeDeps, youtube: MusicProvider): Promise<boolean> {
  try {
    const { tracks, complete } = await youtube.read();
    await deps.report({
      name: 'YouTube: leer Me gusta',
      ok: complete,
      detail: `${tracks.length} canciones${complete ? '' : ', lectura incompleta'}`,
    });
    return complete;
  } catch (error) {
    await deps.report({ name: 'YouTube: leer Me gusta', ok: false, detail: safeError(error).message });
    return false;
  }
}

/** Only reads. Reports which Apple combinations work and whether YouTube is signed in. */
export async function runReadProbe(deps: ProbeDeps): Promise<void> {
  if (deps.appleToken) await findAppleConnections(deps, deps.appleToken);
  else await deps.report({ name: 'Apple', ok: false, detail: 'Falta cargar el token' });

  if (deps.youtube) await probeYouTubeRead(deps, deps.youtube);
  else await deps.report({ name: 'YouTube', ok: false, detail: 'Falta cargar la cookie' });
}

async function probeAppleWrite(deps: ProbeDeps, token: string, query: string): Promise<void> {
  const connections = await findAppleConnections(deps, token);
  const first = connections[0];
  if (!first) return;

  const { results } = await first.client.Search.search({ term: query, types: [ResourceType.Songs], limit: 1 });
  const song = results.songs?.data?.[0] as { id: string; attributes?: { name?: string } } | undefined;
  if (!song) {
    await deps.report({ name: 'Apple: buscar canción de prueba', ok: false, detail: 'Sin resultados' });
    return;
  }

  const findOwned = async (client: AppleMusic) =>
    (await client.Library.getAllSongs()).songs.find((item) => item.attributes?.playParams?.catalogId === song.id);

  if (await findOwned(first.client)) {
    await deps.report({
      name: 'Apple: canción de prueba',
      ok: false,
      detail: 'Ya está en tu biblioteca, así que no la toco. Elegí otra.',
    });
    return;
  }
  await deps.report({ name: 'Apple: canción de prueba', ok: true, detail: song.attributes?.name ?? song.id });

  const waitMs = deps.waitMs ?? POLL_INTERVAL_MS;
  let added = false;
  for (const { baseUrl, header } of connections) {
    const label = `${new URL(baseUrl).hostname} y ${header}`;
    // Clients share one configuration, so the combination is applied again before using it.
    const client = await deps.createAppleClient({
      userToken: token,
      storefront: deps.storefront,
      baseURL: baseUrl,
      userTokenHeader: header,
      maxRetries: 0,
    });

    try {
      if (!added) {
        await client.Library.addSongs([song.id]);
        await deps.report({ name: `Apple: agregar con ${label}`, ok: true });
        added = true;
      }
    } catch (error) {
      await deps.report({ name: `Apple: agregar con ${label}`, ok: false, detail: safeError(error).message });
      continue;
    }

    const owned = await pollForOwned(() => findOwned(client), waitMs);
    if (!owned) {
      await deps.report({
        name: 'Apple: ver la canción agregada',
        ok: false,
        detail: 'No apareció en tu biblioteca. Si aparece más tarde, quitala a mano.',
      });
      return;
    }

    try {
      await client.Library.removeSong(owned.id);
      await deps.report({ name: `Apple: quitar con ${label}`, ok: true });
    } catch (error) {
      await deps.report({ name: `Apple: quitar con ${label}`, ok: false, detail: safeError(error).message });
      continue;
    }

    const gone = await waitFor(async () => (await findOwned(client)) === undefined, waitMs);
    await deps.report({
      name: 'Apple: confirmar que se quitó',
      ok: gone,
      ...(gone ? {} : { detail: 'Sigue en tu biblioteca. Quitala a mano.' }),
    });
    if (gone) await deps.markDeleteVerified?.('apple');
    return;
  }

  if (added) {
    await deps.report({
      name: 'Apple: quitar',
      ok: false,
      detail: `Ninguna combinación pudo quitar "${song.attributes?.name ?? song.id}". Quitala a mano.`,
    });
  }
}

async function pollForOwned<T>(find: () => Promise<T | undefined>, waitMs: number): Promise<T | undefined> {
  let owned: T | undefined;
  await waitFor(async () => {
    owned = await find();
    return owned !== undefined;
  }, waitMs);
  return owned;
}

async function probeYouTubeWrite(deps: ProbeDeps, youtube: MusicProvider, query: string): Promise<void> {
  if (!(await probeYouTubeRead(deps, youtube))) return;

  const [song] = await youtube.search({ id: '', title: query, artist: '' });
  if (!song) {
    await deps.report({ name: 'YouTube: buscar canción de prueba', ok: false, detail: 'Sin resultados' });
    return;
  }

  const isLiked = async () => (await youtube.read()).tracks.some((track) => track.id === song.id);
  if (await isLiked()) {
    await deps.report({
      name: 'YouTube: canción de prueba',
      ok: false,
      detail: 'Ya está en tus Me gusta, así que no la toco. Elegí otra.',
    });
    return;
  }
  await deps.report({ name: 'YouTube: canción de prueba', ok: true, detail: song.title });

  const waitMs = deps.waitMs ?? POLL_INTERVAL_MS;
  await youtube.add(song);
  const liked = await waitFor(isLiked, waitMs);
  await deps.report({
    name: 'YouTube: dar Me gusta',
    ok: liked,
    ...(liked ? {} : { detail: 'No apareció en tus Me gusta. Si aparece más tarde, quitalo a mano.' }),
  });
  if (!liked) return;

  await youtube.remove(song);
  const gone = await waitFor(async () => !(await isLiked()), waitMs);
  await deps.report({
    name: 'YouTube: quitar Me gusta',
    ok: gone,
    ...(gone ? {} : { detail: `Sigue en tus Me gusta: "${song.title}". Quitalo a mano.` }),
  });
  if (gone) await deps.markDeleteVerified?.('youtube');
}

/**
 * Adds and removes one song found with the query on each service. It refuses to touch a song
 * you already have, and only marks deleting as verified after confirming the song is gone.
 */
export async function runWriteProbe(deps: ProbeDeps, query: string): Promise<void> {
  const guarded = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      await deps.report({ name, ok: false, detail: safeError(error).message });
    }
  };

  if (deps.appleToken) {
    const token = deps.appleToken;
    await guarded('Apple', () => probeAppleWrite(deps, token, query));
  } else {
    await deps.report({ name: 'Apple', ok: false, detail: 'Falta cargar el token' });
  }

  if (deps.youtube) {
    const youtube = deps.youtube;
    await guarded('YouTube', () => probeYouTubeWrite(deps, youtube, query));
  } else {
    await deps.report({ name: 'YouTube', ok: false, detail: 'Falta cargar la cookie' });
  }
}
