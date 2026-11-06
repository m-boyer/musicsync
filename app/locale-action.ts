'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale, LOCALE_COOKIE } from '../src/i18n/index';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Open to everyone, including the sign-in page: it only stores the viewer's language. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: ONE_YEAR, path: '/', sameSite: 'lax', httpOnly: true });
  revalidatePath('/', 'layout');
}
