import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicProvider } from '../src/providers/types.js';
import { createContextLoader } from '../src/sync/context.js';
import { SyncController, type LoadedCycle } from '../src/sync/controller.js';
import type { CycleDeps } from '../src/sync/cycle.js';
import type { Settings } from '../src/repos/settings.js';
import { FakeRepo, fakeProvider } from './fakes.js';

vi.mock('../src/errorTracking.js', () => ({ captureError: vi.fn() }));

const options = { mode: 'dry-run' as const, maxOpsPerCycle: 5, maxDeletesPerCycle: 5, graceMs: 0, matchThreshold: 0.8 };

function ready(repo = new FakeRepo(), apple = fakeProvider('apple').provider): { loaded: LoadedCycle; repo: FakeRepo; deps: CycleDeps } {
  const deps: CycleDeps = { apple, youtube: fakeProvider('youtube').provider, repo, options };
  return { loaded: { status: 'ready', deps, intervalMs: 1000 }, repo, deps };
}

describe('SyncController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('runs at once, again after the interval, and stops', async () => {
    const { loaded, repo } = ready();
    const controller = new SyncController({ load: async () => loaded, recordNotConfigured: vi.fn(), recordFailure: vi.fn(async () => {}) });

    controller.start();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.runs).toHaveLength(1);
    expect(controller.state().nextRunAt).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.runs).toHaveLength(2);

    await controller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(repo.runs).toHaveLength(2);
    expect(controller.runNow()).toBe(false);
  });

  it('applies a new interval from the configuration', async () => {
    const { loaded, repo } = ready();
    const load = vi.fn(async () => loaded);
    load.mockResolvedValueOnce({ ...loaded, intervalMs: 5000 } as LoadedCycle);
    const controller = new SyncController({ load, recordNotConfigured: vi.fn(), recordFailure: vi.fn(async () => {}) });

    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.runs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(repo.runs).toHaveLength(2);
    await controller.stop();
  });

  it('runs on demand and resets the wait', async () => {
    const { loaded, repo } = ready();
    const controller = new SyncController({ load: async () => loaded, recordNotConfigured: vi.fn(), recordFailure: vi.fn(async () => {}) });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.runNow()).toBe(true);
    expect(controller.state().running).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.runs).toHaveLength(2);
    await controller.stop();
  });

  it('never starts a second cycle while one runs', async () => {
    const apple = fakeProvider('apple');
    let finish = () => {};
    apple.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ tracks: [], complete: true });
        }),
    );
    const { loaded } = ready(new FakeRepo(), apple.provider);
    const controller = new SyncController({ load: async () => loaded, recordNotConfigured: vi.fn(), recordFailure: vi.fn(async () => {}) });

    controller.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.runNow()).toBe(false);
    expect(apple.read).toHaveBeenCalledTimes(1);

    finish();
    await controller.stop();
  });

  it('runs a test and a cycle one at a time', async () => {
    const { loaded, repo } = ready();
    const controller = new SyncController({ load: async () => loaded, recordNotConfigured: vi.fn(), recordFailure: vi.fn(async () => {}) });
    let finishTest = () => {};
    const test = controller.exclusive(
      () =>
        new Promise<string>((resolve) => {
          finishTest = () => resolve('done');
        }),
    );
    expect(controller.state().exclusiveRunning).toBe(true);

    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.runs).toHaveLength(0);

    finishTest();
    await expect(test).resolves.toBe('done');
    expect(controller.state().exclusiveRunning).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.runs).toHaveLength(1);
    await controller.stop();
  });

  it('keeps going after a failed test', async () => {
    const { loaded, repo } = ready();
    const controller = new SyncController({ load: async () => loaded, recordNotConfigured: vi.fn(), recordFailure: vi.fn(async () => {}) });
    await expect(controller.exclusive(() => Promise.reject(new Error('down')))).rejects.toThrow('down');
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.runs).toHaveLength(1);
    await controller.stop();
  });

  it('records a missing configuration once', async () => {
    const recordNotConfigured = vi.fn(async () => {});
    const { loaded } = ready();
    const load = vi.fn<() => Promise<LoadedCycle>>(async () => ({
      status: 'not_configured',
      missing: ['apple'],
      mode: 'dry-run',
      intervalMs: 1000,
    }));
    const controller = new SyncController({ load, recordNotConfigured, recordFailure: vi.fn(async () => {}) });

    controller.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(recordNotConfigured).toHaveBeenCalledTimes(1);

    load.mockResolvedValueOnce(loaded);
    await vi.advanceTimersByTimeAsync(2000);
    expect(recordNotConfigured).toHaveBeenCalledTimes(2);
    await controller.stop();
  });

  it('survives a configuration that cannot be read, and retries', async () => {
    const { loaded, repo } = ready();
    const load = vi.fn(async () => loaded);
    load.mockRejectedValueOnce(new Error('bad key'));
    const recordFailure = vi.fn(async () => {});
    const controller = new SyncController({ load, recordNotConfigured: vi.fn(), recordFailure, fallbackIntervalMs: 1000 });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ error: 'bad key' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.runs).toHaveLength(1);
    await controller.stop();
  });

  it('keeps going when the failure cannot be recorded', async () => {
    const { loaded, repo } = ready();
    const load = vi.fn(async () => loaded);
    load.mockRejectedValueOnce(new Error('bad key'));
    const recordFailure = vi.fn(async () => Promise.reject(new Error('db down')));
    const controller = new SyncController({ load, recordNotConfigured: vi.fn(), recordFailure, fallbackIntervalMs: 1000 });

    controller.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.runs).toHaveLength(1);
    await controller.stop();
  });
});

describe('createContextLoader', () => {
  const settings: Settings = {
    mode: 'add-only',
    intervalSeconds: 120,
    maxOpsPerCycle: 3,
    maxDeletesPerCycle: 2,
    addGraceMinutes: 10,
    matchThreshold: 0.9,
    appleStorefront: 'ar',
    appleBaseUrl: null,
    appleUserTokenHeader: 'Music-User-Token',
    appleDeleteVerifiedAt: null,
    youtubeDeleteVerifiedAt: null,
  };
  const provider = (service: 'apple' | 'youtube'): MusicProvider => fakeProvider(service).provider;

  function setup(credentials: { apple?: string; youtube?: string }) {
    const createProviders = vi.fn(() => ({ apple: provider('apple'), youtube: provider('youtube') }));
    const loader = createContextLoader({
      getSettings: async () => settings,
      getCredentials: async () => credentials,
      createProviders,
      repo: new FakeRepo(),
    });
    return { loader, createProviders, credentials };
  }

  it('reports what is missing', async () => {
    const { loader, createProviders } = setup({ apple: 'a' });
    expect(await loader.load()).toEqual({ status: 'not_configured', missing: ['youtube'], mode: 'add-only', intervalMs: 120_000 });
    expect((await setup({ youtube: 'y' }).loader.load())).toMatchObject({ missing: ['apple'] });
    expect(createProviders).not.toHaveBeenCalled();
  });

  it('maps settings to the cycle', async () => {
    const loaded = await setup({ apple: 'a', youtube: 'y' }).loader.load();
    expect(loaded).toMatchObject({
      status: 'ready',
      intervalMs: 120_000,
      deps: { options: { mode: 'add-only', maxOpsPerCycle: 3, maxDeletesPerCycle: 2, graceMs: 600_000, matchThreshold: 0.9 } },
    });
  });

  it('reuses clients until a credential changes or it is reset', async () => {
    const { loader, createProviders, credentials } = setup({ apple: 'a', youtube: 'y' });
    await loader.load();
    await loader.load();
    expect(createProviders).toHaveBeenCalledTimes(1);

    credentials.apple = 'renewed';
    await loader.load();
    expect(createProviders).toHaveBeenCalledTimes(2);

    loader.reset();
    await loader.load();
    expect(createProviders).toHaveBeenCalledTimes(3);
  });
});
