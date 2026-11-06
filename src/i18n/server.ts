import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, pickLocale, render, translator, type Locale, type Message, type Translate } from './index.js';

/** The viewer's language: the saved choice, otherwise the browser's. */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return pickLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get('accept-language'));
}

export async function getI18n(): Promise<{ locale: Locale; t: Translate; say: (message: Message) => string }> {
  const locale = await getLocale();
  return { locale, t: translator(locale), say: (message) => render(locale, message) };
}
