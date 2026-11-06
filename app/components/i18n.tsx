'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useTransition, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  LOCALES,
  render,
  translator,
  type Locale,
  type Message,
  type Translate,
} from '../../src/i18n/index';
import { setLocale } from '../locale-action';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useI18n(): { locale: Locale; t: Translate; say: (message: Message) => string } {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({ locale, t: translator(locale), say: (message: Message) => render(locale, message) }), [locale]);
}

export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      aria-label={t('common.language')}
      className="w-auto py-1 text-sm"
      value={locale}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
    >
      {LOCALES.map((value) => (
        <option key={value} value={value}>
          {LOCALE_NAMES[value]}
        </option>
      ))}
    </select>
  );
}
