'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Shows a date in the viewer's own time zone. */
export function LocalTime({ value }: { value: Date | string | null | undefined }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (value) setText(new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)));
  }, [value]);
  if (!value) return <span>never</span>;
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
