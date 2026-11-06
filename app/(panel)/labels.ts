import type { Tone } from '../components/ui';

export const SERVICE_NAMES = { apple: 'Apple Music', youtube: 'YouTube Music' } as const;

export const MODE_LABELS = {
  'dry-run': 'Simulate (dry-run)',
  'add-only': 'Add only (add-only)',
  full: 'Add and remove (full)',
} as const;

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: 'OK', tone: 'ok' },
  partial: { label: 'With errors', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  not_configured: { label: 'Not configured', tone: 'neutral' },
};

export function runStatus(status: string): { label: string; tone: Tone } {
  return RUN_STATUS[status] ?? { label: status, tone: 'neutral' };
}

/** Apple's token lasts about 180 days. */
export const TOKEN_WARN_DAYS = 150;

export function tokenAgeDays(updatedAt: Date, now = new Date()): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
}
