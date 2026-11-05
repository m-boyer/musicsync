import { captureError } from './errorTracking.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level | undefined) ?? 'info'] ?? order.info;

function write(level: Level, message: string, extra?: Record<string, unknown>): void {
  if (order[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...extra });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) };
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) => write('debug', message, extra),
  info: (message: string, extra?: Record<string, unknown>) => write('info', message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => write('warn', message, extra),
  error: (message: string, error?: unknown, extra?: Record<string, unknown>) => {
    write('error', message, { ...extra, ...(error === undefined ? {} : errorFields(error)) });
    captureError(message, error, extra);
  },
};
