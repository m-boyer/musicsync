import { createHash } from 'node:crypto';
import type { MusicProvider, Service } from '../providers/types.js';
import type { CredentialValues } from '../repos/credentials.js';
import type { Settings } from '../repos/settings.js';
import type { StateRepo } from '../repos/state.js';
import type { LoadedCycle } from './controller.js';

export interface Providers {
  apple: MusicProvider;
  youtube: MusicProvider;
}

export interface ContextDeps {
  getSettings(): Promise<Settings>;
  getCredentials(): Promise<CredentialValues>;
  createProviders(credentials: Required<CredentialValues>, settings: Settings): Providers;
  repo: StateRepo;
}

export interface ContextLoader {
  load(): Promise<LoadedCycle>;
  /** Forces new clients on the next load, for example after a connection test. */
  reset(): void;
}

/** Reads the configuration on every cycle, so a change applies without a deploy. */
export function createContextLoader(deps: ContextDeps): ContextLoader {
  let cached: { key: string; providers: Providers } | undefined;

  return {
    reset() {
      cached = undefined;
    },
    async load() {
      const [settings, credentials] = await Promise.all([deps.getSettings(), deps.getCredentials()]);
      const intervalMs = settings.intervalSeconds * 1000;

      const missing: Service[] = [];
      if (!credentials.apple) missing.push('apple');
      if (!credentials.youtube) missing.push('youtube');
      if (!credentials.apple || !credentials.youtube) {
        cached = undefined;
        return { status: 'not_configured', missing, mode: settings.mode, intervalMs };
      }

      const key = createHash('sha256')
        .update(
          JSON.stringify([
            credentials.apple,
            credentials.youtube,
            settings.appleStorefront,
            settings.appleBaseUrl,
            settings.appleUserTokenHeader,
          ]),
        )
        .digest('hex');
      if (cached?.key !== key) {
        cached = {
          key,
          providers: deps.createProviders({ apple: credentials.apple, youtube: credentials.youtube }, settings),
        };
      }

      return {
        status: 'ready',
        intervalMs,
        deps: {
          ...cached.providers,
          repo: deps.repo,
          options: {
            mode: settings.mode,
            maxOpsPerCycle: settings.maxOpsPerCycle,
            maxDeletesPerCycle: settings.maxDeletesPerCycle,
            graceMs: settings.addGraceMinutes * 60_000,
            matchThreshold: settings.matchThreshold,
          },
        },
      };
    },
  };
}
