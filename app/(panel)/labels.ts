import type { MessageKey, Translate } from '../../src/i18n/index';
import type { Tone } from '../components/ui';

export const MODES = ['dry-run', 'add-only', 'full'] as const;

export function modeLabel(t: Translate, mode: string): string {
  return (MODES as readonly string[]).includes(mode) ? t(`modes.${mode as (typeof MODES)[number]}`) : mode;
}

const RUN_TONES: Record<string, Tone> = {
  ok: 'ok',
  partial: 'warn',
  blocked: 'warn',
  failed: 'bad',
  not_configured: 'neutral',
};

export function runStatus(t: Translate, status: string): { label: string; tone: Tone } {
  const tone = RUN_TONES[status];
  return tone ? { label: t(`runStatus.${status}` as MessageKey), tone } : { label: status, tone: 'neutral' };
}

/** Looks up a key built from stored data, falling back to the raw value when it is unknown. */
export function labelFor(t: Translate, prefix: string, value: string): string {
  const key = `${prefix}.${value}` as MessageKey;
  const text = t(key);
  return text === key ? value : text;
}

/** Apple's token lasts about 180 days. */
export const TOKEN_WARN_DAYS = 150;

export function tokenAgeDays(updatedAt: Date, now = new Date()): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
}
