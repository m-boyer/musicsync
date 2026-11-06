import en from './messages/en.json';
import es from './messages/es.json';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'locale';
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español' };

/** English is the reference: every other language must have the same keys. */
export type Messages = typeof en;
type Plural = { one: string; other: string };

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;

/**
 * Text saved to the database (test steps, errors) is stored as a key, so it is shown in the
 * language of whoever reads it. Plain strings come from outside, such as a service's error, or
 * from rows saved before translations existed.
 */
export interface Localized {
  key: MessageKey;
  params?: Params;
}
export type Message = Localized | string;
export type Params = Record<string, string | number | Localized>;

export const MESSAGES: Record<Locale, Messages> = { en, es: es satisfies Messages };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function lookup(messages: Messages, key: string): string | Plural | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || (typeof node === 'object' && node !== null && 'other' in node)
    ? (node as string | Plural)
    : undefined;
}

export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  const found = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES[DEFAULT_LOCALE], key);
  if (found === undefined) return key;
  const template =
    typeof found === 'string'
      ? found
      : new Intl.PluralRules(locale).select(Number(params.count ?? 0)) === 'one'
        ? found.one
        : found.other;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'object' ? translate(locale, value.key, value.params) : String(value);
  });
}

export function render(locale: Locale, message: Message): string {
  return typeof message === 'string' ? message : translate(locale, message.key, message.params);
}

export type Translate = (key: MessageKey, params?: Params) => string;

export function translator(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

export function message(key: MessageKey, params?: Params): Localized {
  return params ? { key, params } : { key };
}

/** The saved choice wins, then the browser's languages in order of preference. */
export function pickLocale(saved: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(saved)) return saved;
  const preferred = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { language: tag.split('-')[0]!.toLowerCase(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((item) => item.language && !Number.isNaN(item.q))
    .sort((a, b) => b.q - a.q);
  return preferred.map((item) => item.language).find(isLocale) ?? DEFAULT_LOCALE;
}

/** An error whose text can be shown in any language. Its message is the English text, for logs. */
export class LocalizedError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly params?: Params,
  ) {
    super(translate(DEFAULT_LOCALE, key, params));
    this.name = 'LocalizedError';
  }

  toMessage(): Localized {
    return message(this.key, this.params);
  }
}
