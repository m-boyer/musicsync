'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '../../src/auth/guard';
import { logger } from '../../src/logger';
import { APPLE_HEADERS, APPLE_HOSTS } from '../../src/probe/run';
import { startProbe } from '../../src/probe/start';
import type { PlaylistInfo } from '../../src/providers/types';
import type { ProbeKind } from '../../src/repos/probes';
import { canUseFullMode, editableSettings } from '../../src/repos/settings';
import { getDirectories, getRuntime } from '../../src/runtime';
import { errorMessage, safeError } from '../../src/sync/cycle';
import { LocalizedError } from '../../src/i18n/index';
import { getI18n } from '../../src/i18n/server';

export interface FormState {
  ok?: boolean;
  message?: string;
}

const MAX_CREDENTIAL_LENGTH = 20_000;
const service = z.enum(['apple', 'youtube']);

export async function saveCredential(rawService: string, _prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const { t } = await getI18n();
  const parsedService = service.parse(rawService);
  const value = String(data.get('value') ?? '').trim();
  if (!value) return { ok: false, message: t('credentials.pasteValue') };
  if (value.length > MAX_CREDENTIAL_LENGTH) return { ok: false, message: t('credentials.tooLong') };
  await getRuntime().credentials.save(parsedService, value);
  revalidatePath('/', 'layout');
  return { ok: true, message: t('common.saved') };
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
  const { t } = await getI18n();
  const parsed = editableSettings.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, message: t('settings.outOfRange') };

  const runtime = getRuntime();
  const current = await runtime.settings.get();
  if (parsed.data.mode === 'full' && current.mode !== 'full') {
    if (!canUseFullMode(current)) {
      return { ok: false, message: t('settings.fullRequiresTest') };
    }
    if (data.get('confirmFull') !== 'on') {
      return { ok: false, message: t('settings.confirmFullRequired') };
    }
  }
  await runtime.settings.update(parsed.data);
  revalidatePath('/', 'layout');
  return { ok: true, message: t('settings.savedNextCycle') };
}

export async function startTest(kind: ProbeKind, _prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const { t } = await getI18n();
  const query = String(data.get('query') ?? '').trim();
  if (kind === 'write' && !query) return { ok: false, message: t('tests.queryRequired') };

  const runtime = getRuntime();
  if (runtime.controller.state().exclusiveRunning) return { ok: false, message: t('tests.alreadyRunning') };
  try {
    await startProbe(runtime, kind, query);
  } catch (error) {
    logger.error('Could not start the test', safeError(error));
    return { ok: false, message: t('tests.couldNotStart') };
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

const MAX_PLAYLIST_NAME = 100;

/** Choosing another playlist restarts the pair, so it needs an explicit confirmation. */
async function needsConfirmation(service: 'apple' | 'youtube', nextId: string | undefined): Promise<boolean> {
  const settings = await getRuntime().settings.get();
  const current = service === 'apple' ? settings.applePlaylist : settings.youtubePlaylist;
  const other = service === 'apple' ? settings.youtubePlaylist : settings.applePlaylist;
  return Boolean(current && other && current.id !== nextId);
}

export async function choosePlaylist(rawService: string, _prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const { t, say } = await getI18n();
  const parsedService = service.parse(rawService);
  const id = String(data.get('id') ?? '');
  if (!id) return { ok: false, message: t('playlists.mustChoose') };
  if ((await needsConfirmation(parsedService, id)) && data.get('confirmChange') !== 'on') {
    return { ok: false, message: t('playlists.mustConfirm') };
  }

  const runtime = getRuntime();
  try {
    const playlist = await runtime.controller.exclusive(async (): Promise<PlaylistInfo | string> => {
      const directory = (await getDirectories(runtime))[parsedService];
      if (!directory) return t('errors.saveCredentialFirst');
      const found = (await directory.list()).find((item) => item.id === id);
      if (!found) return t('playlists.notFound');
      if (!(await directory.isEditable(id))) return t('playlists.notEditable');
      return found;
    });
    if (typeof playlist === 'string') return { ok: false, message: playlist };
    await runtime.settings.selectPlaylist(parsedService, playlist);
  } catch (error) {
    return { ok: false, message: say(errorMessage(error)) };
  } finally {
    runtime.loader.reset();
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: t('playlists.chosenOk') };
}

export async function createPlaylist(rawService: string, _prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const { t, say } = await getI18n();
  const parsedService = service.parse(rawService);
  const name = String(data.get('name') ?? '').trim();
  if (!name) return { ok: false, message: t('playlists.nameRequired') };
  if (name.length > MAX_PLAYLIST_NAME) return { ok: false, message: t('playlists.nameTooLong') };
  if ((await needsConfirmation(parsedService, undefined)) && data.get('confirmChange') !== 'on') {
    return { ok: false, message: t('playlists.mustConfirm') };
  }

  const runtime = getRuntime();
  try {
    const playlist = await runtime.controller.exclusive(async () => {
      const directory = (await getDirectories(runtime))[parsedService];
      if (!directory) throw new LocalizedError('errors.saveCredentialFirst');
      return directory.create(name);
    });
    await runtime.settings.selectPlaylist(parsedService, playlist);
  } catch (error) {
    return { ok: false, message: say(errorMessage(error)) };
  } finally {
    runtime.loader.reset();
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: t('playlists.createdOk', { name }) };
}
