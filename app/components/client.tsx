'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from './i18n';

/** Shows a date in the viewer's own time zone and language. */
export function LocalTime({ value }: { value: Date | string | null | undefined }) {
  const { locale, t } = useI18n();
  const [text, setText] = useState('');
  useEffect(() => {
    if (value) setText(new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)));
  }, [value, locale]);
  if (!value) return <span>{t('common.never')}</span>;
  return <time dateTime={new Date(value).toISOString()}>{text}</time>;
}

/** Keeps a page up to date while something runs in the background. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
