import { logger } from '../logger.js';
import type { CycleDeps } from './cycle.js';
import { safeError } from './cycle.js';
import { runAndRecord } from './loop.js';

export type LoadedCycle =
  | { status: 'ready'; deps: CycleDeps; intervalMs: number }
  | { status: 'not_configured'; missing: string[]; mode: string; intervalMs: number };

export interface ControllerDeps {
  load(): Promise<LoadedCycle>;
  recordNotConfigured(run: { startedAt: Date; mode: string; missing: string[] }): Promise<void>;
  recordFailure(run: { startedAt: Date; error: string }): Promise<void>;
  fallbackIntervalMs?: number;
  now?: () => Date;
}

export interface ControllerState {
  running: boolean;
  exclusiveRunning: boolean;
  nextRunAt: Date | null;
}

const DEFAULT_FALLBACK_MS = 300_000;

/**
 * Runs cycles one at a time and waits for the interval after each one. Connection tests go
 * through {@link SyncController.exclusive} so they never overlap with a cycle either.
 */
export class SyncController {
  private lock: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private running = false;
  private exclusiveCount = 0;
  private nextRunAt: Date | null = null;
  private wasNotConfigured = false;
  private current: Promise<void> = Promise.resolve();

  constructor(private readonly deps: ControllerDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private withLock<T>(run: () => Promise<T>): Promise<T> {
    const result = this.lock.then(run, run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  private async cycle(): Promise<number> {
    const startedAt = this.now();
    const loaded = await this.deps.load();
    if (loaded.status === 'not_configured') {
      // A single entry per change, instead of one every few minutes until it is configured.
      if (!this.wasNotConfigured) {
        await this.deps.recordNotConfigured({ startedAt, mode: loaded.mode, missing: loaded.missing });
        logger.info('Sync not configured', { missing: loaded.missing });
      }
      this.wasNotConfigured = true;
      return loaded.intervalMs;
    }
    this.wasNotConfigured = false;
    await runAndRecord(loaded.deps);
    return loaded.intervalMs;
  }

  private tick(): void {
    clearTimeout(this.timer);
    this.nextRunAt = null;
    this.running = true;
    const startedAt = this.now();
    this.current = this.withLock(() => this.cycle())
      .catch(async (error: unknown) => {
        const safe = safeError(error);
        logger.error('Sync could not start', safe);
        // Recorded so the web shows it, not only the logs.
        await this.deps.recordFailure({ startedAt, error: safe.message }).catch(() => undefined);
        return this.deps.fallbackIntervalMs ?? DEFAULT_FALLBACK_MS;
      })
      .then((intervalMs) => {
        this.running = false;
        if (this.stopped) return;
        this.nextRunAt = new Date(this.now().getTime() + intervalMs);
        this.timer = setTimeout(() => this.tick(), intervalMs);
      });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.tick();
  }

  /** Starts a cycle now. Returns false if one is already running. */
  runNow(): boolean {
    if (this.running || this.stopped) return false;
    this.tick();
    return true;
  }

  async exclusive<T>(run: () => Promise<T>): Promise<T> {
    this.exclusiveCount += 1;
    try {
      return await this.withLock(run);
    } finally {
      this.exclusiveCount -= 1;
    }
  }

  state(): ControllerState {
    return { running: this.running, exclusiveRunning: this.exclusiveCount > 0, nextRunAt: this.nextRunAt };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.current;
    await this.lock;
  }
}
