'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '../../src/auth/client';
import { useI18n } from '../components/i18n';

export function SignOut() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <button
      className="cursor-pointer whitespace-nowrap text-muted hover:text-ink"
      onClick={async () => {
        await authClient.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      {t('nav.signOut')}
    </button>
  );
}
