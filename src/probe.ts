import { AppleMusic, AuthType, ResourceType, type Region, type UserTokenHeader } from '@syncfm/applemusic-api';
import { createYouTubeClient, createYouTubeProvider } from './providers/youtube.js';
import { safeError } from './sync/cycle.js';

/**
 * Manual check of what each service allows from this machine. Reads only, unless called with
 * `--write`, which adds one song found with PROBE_QUERY on each service and then removes it.
 * It refuses to touch a song you already have. It never prints credentials.
 */
const write = process.argv.includes('--write');
const query = process.env.PROBE_QUERY?.trim();
const appleToken = process.env.APPLE_MEDIA_USER_TOKEN?.trim();
const youtubeCookie = process.env.YT_COOKIE?.trim();
const storefront = (process.env.APPLE_STOREFRONT?.trim().toLowerCase() || 'us') as Region;

const HOSTS = ['https://amp-api.music.apple.com', 'https://amp-api-edge.music.apple.com'];
const HEADERS: UserTokenHeader[] = ['Music-User-Token', 'media-user-token'];
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 10_000;

function report(step: string, result: unknown): void {
  console.log(JSON.stringify({ step, result }));
}

async function attempt<T>(step: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await run();
    report(step, value === undefined ? 'ok' : value);
    return value ?? (true as T);
  } catch (error) {
    report(step, { failed: safeError(error).message });
    return undefined;
  }
}

async function waitFor(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return false;
}

async function probeApple(token: string): Promise<void> {
  const working: { client: AppleMusic; label: string }[] = [];
  for (const baseURL of HOSTS) {
    for (const userTokenHeader of HEADERS) {
      const label = `${baseURL} + ${userTokenHeader}`;
      const client = new AppleMusic({
        authType: AuthType.UserTokenUnofficial,
        userToken: token,
        region: storefront,
        baseURL,
        userTokenHeader,
        maxRetries: 0,
      });
      const ok = await attempt(`apple read: ${label}`, async () => {
        await client.init();
        const page = await client.Library.getSongs(1, 0);
        return { total: page.meta?.total ?? null };
      });
      if (ok) working.push({ client, label });
    }
  }
  if (working.length === 0 || !write || !query) return;

  const finder = working[0]!.client;
  await finder.init();
  const { songs, complete } = await finder.Library.getAllSongs();
  report('apple full read', { songs: songs.length, complete });

  const { results } = await finder.Search.search({ term: query, types: [ResourceType.Songs], limit: 1 });
  const song = results.songs?.data?.[0] as { id: string; attributes?: { name?: string } } | undefined;
  if (!song) return report('apple write', 'skipped: no search result');
  const owned = (list: typeof songs) => list.find((item) => item.attributes?.playParams?.catalogId === song.id);
  if (owned(songs)) return report('apple write', 'skipped: the test song is already in your library');

  report('apple test song', song.attributes?.name ?? song.id);
  for (const { client, label } of working) {
    await client.init();
    if (!(await attempt(`apple add: ${label}`, () => client.Library.addSongs([song.id])))) continue;

    let added: (typeof songs)[number] | undefined;
    await waitFor(async () => {
      added = owned((await client.Library.getAllSongs()).songs);
      return added !== undefined;
    });
    if (!added) {
      report(`apple add: ${label}`, 'did not appear in the library; remove the test song by hand if it shows up');
      return;
    }
    const removed = await attempt(`apple remove: ${label}`, () => client.Library.removeSong(added!.id));
    if (removed) {
      const gone = await waitFor(async () => !owned((await client.Library.getAllSongs()).songs));
      report(`apple remove confirmed: ${label}`, gone);
      return;
    }
  }
  report('apple write', 'no combination could remove the test song; remove it by hand');
}

async function probeYouTube(cookie: string): Promise<void> {
  const provider = createYouTubeProvider(() => createYouTubeClient(cookie));
  const read = await attempt('youtube full read', async () => {
    const { tracks, complete } = await provider.read();
    report('youtube read summary', { songs: tracks.length, complete });
    return { tracks };
  });
  if (!read || !write || !query) return;

  const [song] = await provider.search({ id: '', title: query, artist: '' });
  if (!song) return report('youtube write', 'skipped: no search result');
  const liked = async () => (await provider.read()).tracks.some((track) => track.id === song.id);
  if (await liked()) return report('youtube write', 'skipped: the test song is already in your likes');

  report('youtube test song', song.title);
  if (!(await attempt('youtube like', () => provider.add(song)))) return;
  report('youtube like confirmed', await waitFor(liked));
  if (!(await attempt('youtube remove like', () => provider.remove(song)))) return;
  report('youtube remove confirmed', await waitFor(async () => !(await liked())));
}

if (write && !query) report('write', 'skipped: set PROBE_QUERY to a song you do not have');
if (appleToken) await probeApple(appleToken);
else report('apple', 'skipped: APPLE_MEDIA_USER_TOKEN is not set');
if (youtubeCookie) await probeYouTube(youtubeCookie);
else report('youtube', 'skipped: YT_COOKIE is not set');
