import { describe, expect, it } from 'vitest';
import {
  isLocale,
  LOCALES,
  LocalizedError,
  message,
  MESSAGES,
  pickLocale,
  render,
  translate,
  translator,
  type MessageKey,
} from '../src/i18n/index.js';
import { errorMessage, safeError } from '../src/sync/cycle.js';

type Tree = { [key: string]: string | Tree };

/** Every leaf as "path → text". Plural forms are leaves under their key. */
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [inner, text] of leaves(value, path)) out.set(inner, text);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('message files', () => {
  const reference = leaves(MESSAGES.en as unknown as Tree);

  it.each(LOCALES.filter((locale) => locale !== 'en'))('%s has exactly the same keys as en', (locale) => {
    const other = leaves(MESSAGES[locale] as unknown as Tree);
    expect([...other.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it.each(LOCALES)('%s uses the same placeholders as en and has no empty text', (locale) => {
    for (const [path, text] of leaves(MESSAGES[locale] as unknown as Tree)) {
      expect(text.trim(), path).not.toBe('');
      expect(placeholders(text), path).toEqual(placeholders(reference.get(path) ?? ''));
    }
  });
});

describe('translate', () => {
  it('fills in parameters and leaves unknown ones visible', () => {
    expect(translate('en', 'home.tokenAge', { days: 12 })).toBe('Token is 12 days old');
    expect(translate('es', 'home.tokenAge', { days: 12 })).toBe('Token de 12 días');
    expect(translate('en', 'home.tokenAge')).toBe('Token is {days} days old');
  });

  it('picks the plural form for each language', () => {
    expect(translate('en', 'common.songs', { count: 1 })).toBe('1 song');
    expect(translate('en', 'common.songs', { count: 0 })).toBe('0 songs');
    expect(translate('es', 'common.songs', { count: 1 })).toBe('1 canción');
    expect(translate('es', 'common.songs', { count: 3 })).toBe('3 canciones');
    expect(translate('en', 'common.songs')).toBe('{count} songs');
  });

  it('translates nested messages in the same language', () => {
    const nested = message('errors.serviceRead', { service: 'YouTube Music', error: message('errors.youtubeSessionInvalid') });
    expect(render('es', nested)).toBe('YouTube Music: La sesión de YouTube no es válida: cargá la cookie de nuevo');
  });

  it('returns the key itself when it does not exist', () => {
    expect(translate('en', 'nope.missing' as MessageKey)).toBe('nope.missing');
    expect(translate('en', 'home' as MessageKey)).toBe('home');
  });

  it('shows plain strings as they are', () => {
    expect(render('es', 'Request failed (HTTP 500)')).toBe('Request failed (HTTP 500)');
    expect(translator('es')('nav.home')).toBe('Inicio');
    expect(message('nav.home')).toEqual({ key: 'nav.home' });
  });
});

describe('pickLocale', () => {
  it('prefers the saved choice', () => {
    expect(pickLocale('es', 'en-US,en;q=0.9')).toBe('es');
  });

  it('follows the browser order and weights', () => {
    expect(pickLocale(undefined, 'es-AR,es;q=0.9,en;q=0.8')).toBe('es');
    expect(pickLocale(undefined, 'fr-FR, es;q=0.5, en;q=0.7')).toBe('en');
    expect(pickLocale('xx', 'de, fr')).toBe('en');
    expect(pickLocale(undefined, null)).toBe('en');
    expect(pickLocale(undefined, 'es;q=abc')).toBe('en');
  });

  it('only accepts known languages', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(3)).toBe(false);
  });
});

describe('LocalizedError', () => {
  it('logs in English and is saved as a key', () => {
    const error = new LocalizedError('errors.cannotDecrypt');
    expect(error.message).toContain('cannot be decrypted');
    expect(safeError(error)).toBe(error);
    expect(errorMessage(error)).toEqual({ key: 'errors.cannotDecrypt' });
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
