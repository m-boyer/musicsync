import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireSession } from '../../src/auth/guard';
import { SignOut } from './sign-out';

const LINKS = [
  ['/', 'Home'],
  ['/credentials', 'Credentials'],
  ['/playlists', 'Playlists'],
  ['/tests', 'Tests'],
  ['/settings', 'Settings'],
  ['/history', 'History'],
  ['/pending', 'Pending'],
] as const;

// Private pages that depend on the session: never prerendered.
export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
      <nav className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-3">
        <span className="font-semibold">musicsync</span>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="text-muted hover:text-ink">
            {label}
          </Link>
        ))}
        <span className="ml-auto">
          <SignOut />
        </span>
      </nav>
      <main>{children}</main>
    </div>
  );
}
