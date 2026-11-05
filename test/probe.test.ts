import type { AppleMusic } from '@syncfm/applemusic-api';
import { describe, expect, it, vi } from 'vitest';
import { APPLE_HEADERS, APPLE_HOSTS, runReadProbe, runWriteProbe, type ProbeDeps } from '../src/probe/run.js';
import type { ProbeStep } from '../src/repos/probes.js';
import { fakeProvider } from './fakes.js';

const librarySong = { id: 'i.1', attributes: { playParams: { catalogId: 'c1' } } };

function appleFake() {
  const Library = {
    getSongs: vi.fn(async () => ({ data: [], meta: { total: 3 } })),
    getAllSongs: vi.fn(async () => ({ songs: [] as (typeof librarySong)[], complete: true })),
    addSongs: vi.fn(async () => {}),
    removeSong: vi.fn(async () => {}),
  };
  const Search = { search: vi.fn(async () => ({ results: { songs: { data: [{ id: 'c1', attributes: { name: 'Test' } }] } } })) };
  return { Library, Search, client: { Library, Search } as unknown as AppleMusic };
}

function setup(overrides: Partial<ProbeDeps> = {}, apple = appleFake()) {
  const steps: ProbeStep[] = [];
  const markDeleteVerified = vi.fn(async () => {});
  const deps: ProbeDeps = {
    appleToken: 'token',
    storefront: 'ar',
    createAppleClient: vi.fn(async () => apple.client),
    youtube: undefined,
    report: async (step) => {
      steps.push(step);
    },
    markDeleteVerified,
    waitMs: 0,
    ...overrides,
  };
  return { deps, steps, apple, markDeleteVerified };
}

const named = (steps: ProbeStep[], text: string) => steps.filter((step) => step.name.includes(text));

describe('runReadProbe', () => {
  it('tries every Apple combination and offers the ones that work', async () => {
    const { deps, steps } = setup();
    await runReadProbe(deps);
    expect(deps.createAppleClient).toHaveBeenCalledTimes(APPLE_HOSTS.length * APPLE_HEADERS.length);
    expect(steps[0]).toMatchObject({ ok: true, detail: '3 canciones', connection: { baseUrl: APPLE_HOSTS[0], header: APPLE_HEADERS[0] } });
  });

  it('reports a failed combination without credentials', async () => {
    const { deps, steps } = setup({
      createAppleClient: vi.fn(async () => {
        throw Object.assign(new Error('Forbidden'), { response: { status: 403 }, config: { headers: { token: 'secret' } } });
      }),
    });
    await runReadProbe(deps);
    expect(steps[0]).toMatchObject({ ok: false, detail: 'Forbidden (HTTP 403)' });
    expect(JSON.stringify(steps)).not.toContain('secret');
  });

  it('reports missing credentials', async () => {
    const { deps, steps } = setup({ appleToken: undefined });
    await runReadProbe(deps);
    expect(steps).toEqual([
      { name: 'Apple', ok: false, detail: 'Falta cargar el token' },
      { name: 'YouTube', ok: false, detail: 'Falta cargar la cookie' },
    ]);
  });

  it('reports a YouTube read, complete or not', async () => {
    const youtube = fakeProvider('youtube', [{ id: 'y', title: 't', artist: 'a' }]);
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runReadProbe(deps);
    expect(named(steps, 'YouTube')[0]).toMatchObject({ ok: true, detail: '1 canciones' });

    youtube.read.mockResolvedValueOnce({ tracks: [], complete: false });
    await runReadProbe(deps);
    expect(named(steps, 'YouTube')[1]).toMatchObject({ ok: false });

    youtube.read.mockRejectedValueOnce(new Error('expired'));
    await runReadProbe(deps);
    expect(named(steps, 'YouTube')[2]).toMatchObject({ ok: false, detail: 'expired' });
  });
});

describe('runWriteProbe on Apple', () => {
  /** The library has the song only between adding it and removing it. */
  function liveLibrary(apple: ReturnType<typeof appleFake>) {
    let has = false;
    apple.Library.addSongs.mockImplementation(async () => {
      has = true;
    });
    apple.Library.removeSong.mockImplementation(async () => {
      has = false;
    });
    apple.Library.getAllSongs.mockImplementation(async () => ({ songs: has ? [librarySong] : [], complete: true }));
  }

  it('adds, removes and only then marks deleting as verified', async () => {
    const apple = appleFake();
    liveLibrary(apple);
    const { deps, steps, markDeleteVerified } = setup({}, apple);

    await runWriteProbe(deps, 'test song');

    expect(apple.Library.addSongs).toHaveBeenCalledWith(['c1']);
    expect(apple.Library.removeSong).toHaveBeenCalledWith('i.1');
    expect(named(steps, 'confirmar')[0]).toMatchObject({ ok: true });
    expect(markDeleteVerified).toHaveBeenCalledWith('apple');
  });

  it('refuses to touch a song already in the library', async () => {
    const apple = appleFake();
    apple.Library.getAllSongs.mockResolvedValue({ songs: [librarySong], complete: true });
    const { deps, steps, markDeleteVerified } = setup({}, apple);

    await runWriteProbe(deps, 'test song');

    expect(apple.Library.addSongs).not.toHaveBeenCalled();
    expect(apple.Library.removeSong).not.toHaveBeenCalled();
    expect(markDeleteVerified).not.toHaveBeenCalled();
    expect(named(steps, 'canción de prueba')[0]?.ok).toBe(false);
  });

  it('tries the next combination when removing fails, and tells you if none works', async () => {
    const apple = appleFake();
    liveLibrary(apple);
    apple.Library.removeSong.mockRejectedValue(new Error('Method not allowed'));
    const { deps, steps, markDeleteVerified } = setup({}, apple);

    await runWriteProbe(deps, 'test song');

    expect(apple.Library.addSongs).toHaveBeenCalledTimes(1);
    expect(apple.Library.removeSong).toHaveBeenCalledTimes(APPLE_HOSTS.length * APPLE_HEADERS.length);
    expect(steps.at(-2)?.detail).toContain('Quitala a mano');
    expect(markDeleteVerified).not.toHaveBeenCalled();
  });

  it('warns when the added song never shows up', async () => {
    const apple = appleFake();
    const { deps, steps, markDeleteVerified } = setup({}, apple);
    await runWriteProbe(deps, 'test song');
    expect(named(steps, 'ver la canción')[0]).toMatchObject({ ok: false });
    expect(apple.Library.removeSong).not.toHaveBeenCalled();
    expect(markDeleteVerified).not.toHaveBeenCalled();
  });

  it('does not verify when the song stays after removing', async () => {
    const apple = appleFake();
    apple.Library.getAllSongs
      .mockResolvedValueOnce({ songs: [], complete: true })
      .mockResolvedValue({ songs: [librarySong], complete: true });
    const { deps, steps, markDeleteVerified } = setup({}, apple);
    await runWriteProbe(deps, 'test song');
    expect(named(steps, 'confirmar')[0]).toMatchObject({ ok: false });
    expect(markDeleteVerified).not.toHaveBeenCalled();
  });

  it('tries the next combination when adding fails', async () => {
    const apple = appleFake();
    apple.Library.addSongs.mockRejectedValue(new Error('nope'));
    const { deps, steps } = setup({}, apple);
    await runWriteProbe(deps, 'test song');
    expect(named(steps, 'agregar con').every((step) => !step.ok)).toBe(true);
    expect(apple.Library.removeSong).not.toHaveBeenCalled();
  });

  it('handles no search result and no working combination', async () => {
    const apple = appleFake();
    apple.Search.search.mockResolvedValue({ results: {} } as never);
    const first = setup({}, apple);
    await runWriteProbe(first.deps, 'x');
    expect(named(first.steps, 'buscar')[0]?.detail).toBe('Sin resultados');

    const failing = appleFake();
    failing.Library.getSongs.mockRejectedValue(new Error('no'));
    const second = setup({}, failing);
    await runWriteProbe(second.deps, 'x');
    expect(failing.Search.search).not.toHaveBeenCalled();
  });

  it('reports an unexpected failure', async () => {
    const apple = appleFake();
    apple.Search.search.mockRejectedValue(new Error('search down'));
    const { deps, steps } = setup({}, apple);
    await runWriteProbe(deps, 'x');
    expect(steps.at(-2)).toEqual({ name: 'Apple', ok: false, detail: 'search down' });
  });
});

describe('runWriteProbe on YouTube', () => {
  const song = { id: 'v1', title: 'Test', artist: 'Band' };

  function live() {
    const youtube = fakeProvider('youtube', [], [song]);
    let liked = false;
    youtube.add.mockImplementation(async () => {
      liked = true;
    });
    youtube.remove.mockImplementation(async () => {
      liked = false;
    });
    youtube.read.mockImplementation(async () => ({ tracks: liked ? [song] : [], complete: true }));
    return youtube;
  }

  it('likes, removes and only then marks deleting as verified', async () => {
    const youtube = live();
    const { deps, steps, markDeleteVerified } = setup({ appleToken: undefined, youtube: youtube.provider });

    await runWriteProbe(deps, 'test song');

    expect(youtube.add).toHaveBeenCalledWith(song);
    expect(youtube.remove).toHaveBeenCalledWith(song);
    expect(named(steps, 'quitar Me gusta')[0]?.ok).toBe(true);
    expect(markDeleteVerified).toHaveBeenCalledWith('youtube');
  });

  it('refuses to touch a song already liked', async () => {
    const youtube = fakeProvider('youtube', [song], [song]);
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'test song');
    expect(youtube.add).not.toHaveBeenCalled();
    expect(youtube.remove).not.toHaveBeenCalled();
    expect(named(steps, 'canción de prueba')[0]?.ok).toBe(false);
  });

  it('stops when the like never shows up or the read fails', async () => {
    const youtube = fakeProvider('youtube', [], [song]);
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'test song');
    expect(named(steps, 'dar Me gusta')[0]?.ok).toBe(false);
    expect(youtube.remove).not.toHaveBeenCalled();

    youtube.read.mockRejectedValueOnce(new Error('expired'));
    const count = youtube.add.mock.calls.length;
    await runWriteProbe(deps, 'test song');
    expect(youtube.add).toHaveBeenCalledTimes(count);
  });

  it('does not verify when the like stays', async () => {
    const youtube = live();
    youtube.remove.mockImplementation(async () => {});
    const { deps, steps, markDeleteVerified } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'test song');
    expect(named(steps, 'quitar Me gusta')[0]?.ok).toBe(false);
    expect(markDeleteVerified).not.toHaveBeenCalled();
  });

  it('handles no search result', async () => {
    const youtube = fakeProvider('youtube', [], []);
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'x');
    expect(named(steps, 'buscar')[0]?.detail).toBe('Sin resultados');
  });

  it('reports an unexpected failure', async () => {
    const youtube = live();
    youtube.add.mockRejectedValue(new Error('like failed'));
    const { deps, steps } = setup({ appleToken: undefined, youtube: youtube.provider });
    await runWriteProbe(deps, 'test song');
    expect(steps.at(-1)).toEqual({ name: 'YouTube', ok: false, detail: 'like failed' });
  });
});
