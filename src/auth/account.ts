export const ADMIN_EMAIL = 'matiasboyer7@gmail.com';
export const MIN_PASSWORD_LENGTH = 12;

export function isAdmin(email: string | undefined | null): boolean {
  return email?.toLowerCase() === ADMIN_EMAIL;
}

interface AccountStore {
  password: { hash(password: string): Promise<string> };
  internalAdapter: {
    findUserByEmail(email: string): Promise<unknown>;
    createUser(
      user: { email: string; name: string; emailVerified: boolean },
      source: { method: 'email-password' },
    ): Promise<{ id: string }>;
    linkAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown>;
  };
}

export type EnsureAdminResult = 'exists' | 'created' | 'missing_password' | 'weak_password';

/**
 * Creates the only account the first time the service starts. Sign up is disabled, so this is
 * the only way an account can exist. A password set later is never overwritten.
 */
export async function ensureAdmin(store: AccountStore, password: string | undefined): Promise<EnsureAdminResult> {
  if (await store.internalAdapter.findUserByEmail(ADMIN_EMAIL)) return 'exists';
  if (!password) return 'missing_password';
  if (password.length < MIN_PASSWORD_LENGTH) return 'weak_password';

  const user = await store.internalAdapter.createUser(
    { email: ADMIN_EMAIL, name: 'Admin', emailVerified: true },
    { method: 'email-password' },
  );
  await store.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await store.password.hash(password),
  });
  return 'created';
}
