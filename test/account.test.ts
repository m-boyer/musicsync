import { describe, expect, it, vi } from 'vitest';
import { ADMIN_EMAIL, ensureAdmin, isAdmin } from '../src/auth/account.js';

function store(existing: unknown = null) {
  return {
    password: { hash: vi.fn(async (value: string) => `hashed:${value}`) },
    internalAdapter: {
      findUserByEmail: vi.fn(async () => existing),
      createUser: vi.fn(async () => ({ id: 'user-1' })),
      linkAccount: vi.fn(async () => ({})),
    },
  };
}

describe('isAdmin', () => {
  it('accepts only the account email', () => {
    expect(isAdmin(ADMIN_EMAIL)).toBe(true);
    expect(isAdmin(ADMIN_EMAIL.toUpperCase())).toBe(true);
    expect(isAdmin('someone@example.com')).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe('ensureAdmin', () => {
  it('creates the account with a hashed password', async () => {
    const s = store();
    expect(await ensureAdmin(s, 'a-long-enough-password')).toBe('created');
    expect(s.internalAdapter.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: ADMIN_EMAIL, emailVerified: true }),
      { method: 'email-password' },
    );
    expect(s.internalAdapter.linkAccount).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'credential', password: 'hashed:a-long-enough-password' }),
    );
  });

  it('never overwrites an existing account', async () => {
    const s = store({ user: {} });
    expect(await ensureAdmin(s, 'a-long-enough-password')).toBe('exists');
    expect(s.internalAdapter.createUser).not.toHaveBeenCalled();
    expect(s.internalAdapter.linkAccount).not.toHaveBeenCalled();
  });

  it('does not create an account without a valid password', async () => {
    const s = store();
    expect(await ensureAdmin(s, undefined)).toBe('missing_password');
    expect(await ensureAdmin(s, 'short')).toBe('weak_password');
    expect(s.internalAdapter.createUser).not.toHaveBeenCalled();
  });
});
