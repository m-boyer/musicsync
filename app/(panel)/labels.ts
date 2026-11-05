import type { Tone } from '../components/ui';

export const SERVICE_NAMES = { apple: 'Apple Music', youtube: 'YouTube Music' } as const;

export const MODE_LABELS = {
  'dry-run': 'Simulación (dry-run)',
  'add-only': 'Solo agregar (add-only)',
  full: 'Agregar y borrar (full)',
} as const;

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: 'Correcto', tone: 'ok' },
  partial: { label: 'Con errores', tone: 'warn' },
  blocked: { label: 'Bloqueado', tone: 'warn' },
  failed: { label: 'Falló', tone: 'bad' },
  not_configured: { label: 'Sin configurar', tone: 'neutral' },
};

export function runStatus(status: string): { label: string; tone: Tone } {
  return RUN_STATUS[status] ?? { label: status, tone: 'neutral' };
}

/** Apple's token lasts about 180 days. */
export const TOKEN_WARN_DAYS = 150;

export function tokenAgeDays(updatedAt: Date, now = new Date()): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
}
