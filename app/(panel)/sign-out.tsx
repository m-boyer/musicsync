'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '../../src/auth/client';

export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="cursor-pointer text-muted hover:text-ink"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
