import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAndRecord } from '../src/sync/loop.js';
import type { CycleDeps } from '../src/sync/cycle.js';
import { FakeRepo, fakeProvider } from './fakes.js';

const { captureError } = vi.hoisted(() => ({ captureError: vi.fn() }));
vi.mock('../src/errorTracking.js', () => ({ captureError }));

const options = { mode: 'dry-run' as const, maxOpsPerCycle: 5, maxDeletesPerCycle: 5, graceMs: 0, matchThreshold: 0.8 };

function deps(repo = new FakeRepo()): CycleDeps & { repo: FakeRepo } {
  return { apple: fakeProvider('apple').provider, youtube: fakeProvider('youtube').provider, repo, options };
}

describe('runAndRecord', () => {
  beforeEach(() => {
    captureError.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('records a finished cycle', async () => {
    const d = deps();
    expect(await runAndRecord(d)).toBe('ok');
    expect(d.repo.runs).toMatchObject([{ mode: 'dry-run', status: 'ok' }]);
  });

  it('records and reports a blocked cycle', async () => {
    const d = deps();
    d.youtube.read = async () => ({ tracks: [], complete: false });
    expect(await runAndRecord(d)).toBe('blocked');
    expect(d.repo.runs[0]?.status).toBe('blocked');
    expect(captureError).toHaveBeenCalledWith(
      'Sync blocked: nothing was changed',
      undefined,
      expect.objectContaining({ reason: 'youtube_read_incomplete' }),
    );
  });

  it('does not let credentials in an HTTP error reach the logs or Sentry', async () => {
    const d = deps();
    d.apple.read = async () => {
      throw Object.assign(new Error('Request failed'), {
        response: { status: 401 },
        config: { headers: { 'Music-User-Token': 'secret-token' } },
      });
    };

    expect(await runAndRecord(d)).toBe('failed');

    const sent = captureError.mock.calls[0]?.[1] as Error;
    expect(sent.message).toBe('Apple Music: Request failed (HTTP 401)');
    expect(sent).not.toHaveProperty('config');
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('HTTP 401');
    expect(logged).not.toContain('secret-token');
    expect(d.repo.runs).toMatchObject([{ status: 'failed', summary: { error: 'Apple Music: Request failed (HTTP 401)' } }]);
  });

  it('survives being unable to record the failure', async () => {
    const d = deps();
    d.apple.read = async () => {
      throw new Error('down');
    };
    d.repo.recordRun = async () => {
      throw new Error('db down');
    };
    expect(await runAndRecord(d)).toBe('failed');
  });
});
