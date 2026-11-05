'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '../../src/auth/guard';
import { logger } from '../../src/logger';
import { APPLE_HEADERS, APPLE_HOSTS } from '../../src/probe/run';
import { startProbe } from '../../src/probe/start';
import type { ProbeKind } from '../../src/repos/probes';
import { canUseFullMode, editableSettings } from '../../src/repos/settings';
import { getRuntime } from '../../src/runtime';
import { safeError } from '../../src/sync/cycle';

export interface FormState {
  ok?: boolean;
  message?: string;
}

const MAX_CREDENTIAL_LENGTH = 20_000;
const service = z.enum(['apple', 'youtube']);

export async function saveCredential(rawService: string, _prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const parsedService = service.parse(rawService);
  const value = String(data.get('value') ?? '').trim();
  if (!value) return { ok: false, message: 'Pegá un valor.' };
  if (value.length > MAX_CREDENTIAL_LENGTH) return { ok: false, message: 'El valor es demasiado largo.' };
  await getRuntime().credentials.save(parsedService, value);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Guardado.' };
}

export async function removeCredential(rawService: string): Promise<void> {
  await requireSession();
  await getRuntime().credentials.remove(service.parse(rawService));
  revalidatePath('/', 'layout');
}

export async function runNow(): Promise<void> {
  await requireSession();
  getRuntime().controller.runNow();
  revalidatePath('/', 'layout');
}

export async function saveSettings(_prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const parsed = editableSettings.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, message: 'Revisá los valores: alguno está fuera de rango.' };

  const runtime = getRuntime();
  const current = await runtime.settings.get();
  if (parsed.data.mode === 'full' && current.mode !== 'full') {
    if (!canUseFullMode(current)) {
      return { ok: false, message: 'El modo full requiere que la prueba de agregar y borrar pase en ambos servicios.' };
    }
    if (data.get('confirmFull') !== 'on') {
      return { ok: false, message: 'Confirmá que querés replicar borrados.' };
    }
  }
  await runtime.settings.update(parsed.data);
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Guardado. Se aplica desde el próximo ciclo.' };
}

export async function startTest(kind: ProbeKind, _prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const query = String(data.get('query') ?? '').trim();
  if (kind === 'write' && !query) return { ok: false, message: 'Escribí una canción que no tengas.' };

  const runtime = getRuntime();
  if (runtime.controller.state().exclusiveRunning) return { ok: false, message: 'Ya hay una prueba en curso.' };
  try {
    await startProbe(runtime, kind, query);
  } catch (error) {
    logger.error('Could not start the test', safeError(error));
    return { ok: false, message: 'No se pudo iniciar la prueba.' };
  }
  revalidatePath('/tests');
  return { ok: true };
}

export async function saveAppleConnection(baseUrl: string, header: string): Promise<void> {
  await requireSession();
  const host = z.enum(APPLE_HOSTS as [string, ...string[]]).parse(baseUrl);
  const parsedHeader = z.enum(APPLE_HEADERS as ['Music-User-Token', 'media-user-token']).parse(header);
  await getRuntime().settings.setAppleConnection(host, parsedHeader);
  revalidatePath('/', 'layout');
}

export async function retryMatch(rawService: string, sourceId: string): Promise<void> {
  await requireSession();
  await getRuntime().state.deleteMatch(service.parse(rawService), sourceId);
  revalidatePath('/pending');
}

export async function ignoreMatch(rawService: string, sourceId: string): Promise<void> {
  await requireSession();
  const { state } = getRuntime();
  const match = await state.getMatch(service.parse(rawService), sourceId);
  if (match) await state.saveMatch({ ...match, status: 'ignored', reason: 'manual' });
  revalidatePath('/pending');
}

export async function pickMatch(
  rawService: string,
  sourceId: string,
  target: { id: string; title: string; artist: string },
): Promise<void> {
  await requireSession();
  const { state } = getRuntime();
  const match = await state.getMatch(service.parse(rawService), sourceId);
  if (match) {
    await state.saveMatch({
      ...match,
      status: 'matched',
      targetId: target.id,
      targetTitle: target.title,
      targetArtist: target.artist,
      score: undefined,
      reason: 'manual',
    });
  }
  revalidatePath('/pending');
}
