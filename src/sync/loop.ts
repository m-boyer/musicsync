import { logger } from '../logger.js';
import { runCycle, safeError, type CycleDeps, type CycleResult } from './cycle.js';

/** Runs one cycle and records it. Never rejects, so a bad cycle cannot stop the service. */
export async function runAndRecord(deps: CycleDeps): Promise<CycleResult['status']> {
  const startedAt = (deps.now ?? (() => new Date()))();
  const { mode } = deps.options;
  try {
    const { status, summary } = await runCycle(deps);
    await deps.repo.recordRun({ startedAt, mode, status, summary: { ...summary } });
    if (status === 'blocked') {
      logger.error('Sync blocked: nothing was changed', undefined, { reason: summary.blockedReason });
    } else {
      logger.info('Sync finished', { mode, status, ...summary });
    }
    return status;
  } catch (error) {
    const safe = safeError(error);
    logger.error('Sync failed', safe);
    try {
      await deps.repo.recordRun({ startedAt, mode, status: 'failed', summary: { error: safe.message } });
    } catch (recordError) {
      logger.warn('Could not record the failed run', { error: safeError(recordError).message });
    }
    return 'failed';
  }
}
