import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireSession } from '../../src/auth/guard';
import type { MessageKey } from '../../src/i18n/index';
import { getI18n } from '../../src/i18n/server';
import { LocaleSwitcher } from '../components/i18n';
import { SignOut } from './sign-out';

const LINKS: [string, MessageKey][] = [
  ['/', 'nav.home'],
  ['/credentials', 'nav.credentials'],
  ['/playlists', 'nav.playlists'],
  ['/tests', 'nav.tests'],
  ['/settings', 'nav.settings'],
  ['/history', 'nav.history'],
  ['/pending', 'nav.pending'],
];

// Private pages that depend on the session: never prerendered.
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const { t } = await getI18n();
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
      <nav className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        <span className="font-semibold">musicsync</span>
        {LINKS.map(([href, key]) => (
          <Link key={href} href={href} className="text-muted hover:text-ink">
            {t(key)}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <LocaleSwitcher />
          <SignOut />
        </span>
      </nav>
      <main>{children}</main>
    </div>
  );
}
