import * as Sentry from '@sentry/node';

/**
 * Error reporting to GlitchTip (Sentry-compatible). Disabled when SENTRY_DSN is unset, so local
 * runs and tests send nothing. Every `logger.error` call is forwarded here.
 */
export function initErrorTracking(component: string): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: process.env.APP_REVISION,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    initialScope: { tags: { component } },
    // GlitchTip only needs errors; performance tracing would just add overhead.
    tracesSampleRate: 0,
  });
}

export function captureError(message: string, error: unknown, extra?: Record<string, unknown>): void {
  if (!Sentry.isInitialized()) return;
  if (error === undefined) {
    Sentry.captureMessage(message, { level: 'error', extra });
  } else {
    Sentry.captureException(error, { extra: { message, ...extra } });
  }
}

/** Waits for queued events to be sent; call before `process.exit` on fatal errors. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (Sentry.isInitialized()) await Sentry.flush(timeoutMs);
}
