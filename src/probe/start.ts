import { logger } from '../logger.js';
import { createAppleClient } from '../providers/apple.js';
import { createYouTubeClient, createYouTubeProvider } from '../providers/youtube.js';
import type { ProbeKind } from '../repos/probes.js';
import type { Runtime } from '../runtime.js';
import { safeError } from '../sync/cycle.js';
import { runReadProbe, runWriteProbe, type ProbeDeps } from './run.js';

/** Runs in the background because a write test can take minutes. The page follows its steps. */
export async function startProbe(runtime: Runtime, kind: ProbeKind, query: string): Promise<void> {
  const id = await runtime.probes.start(kind);

  void runtime.controller
    .exclusive(async () => {
      const [values, settings] = await Promise.all([runtime.credentials.values(), runtime.settings.get()]);
      const cookie = values.youtube;
      const deps: ProbeDeps = {
        appleToken: values.apple,
        storefront: settings.appleStorefront,
        createAppleClient,
        youtube: cookie ? createYouTubeProvider(() => createYouTubeClient(cookie)) : undefined,
        report: (step) => runtime.probes.addStep(id, step),
        markDeleteVerified: (service) => runtime.settings.markDeleteVerified(service, new Date()),
      };
      if (kind === 'write') await runWriteProbe(deps, query);
      else await runReadProbe(deps);
    })
    .catch(async (error: unknown) => {
      const safe = safeError(error);
      logger.error('Connection test failed', safe);
      await runtime.probes.addStep(id, { name: 'Prueba', ok: false, detail: safe.message });
    })
    .finally(async () => {
      // The Apple client shares one configuration, which the test changed.
      runtime.loader.reset();
      await runtime.probes.finish(id).catch((error: unknown) => {
        logger.warn('Could not finish the test', { error: safeError(error).message });
      });
    });
}
