import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import type pg from 'pg';
import { isAdmin, MIN_PASSWORD_LENGTH } from './account.js';

const SEVEN_DAYS = 60 * 60 * 24 * 7;

export function createAuth(options: { pool: pg.Pool; secret: string; baseURL: string; adminEmail: string }) {
  return betterAuth({
    database: options.pool,
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [options.baseURL],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    disabledPaths: ['/sign-up/email', '/request-password-reset', '/reset-password', '/update-user', '/delete-user', '/change-email'],
    session: { expiresIn: SEVEN_DAYS, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: { '/sign-in/email': { window: 300, max: 5 }, '/change-password': { window: 300, max: 5 } },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] } },
    databaseHooks: {
      user: {
        create: {
          // A second safeguard: no other account can ever be created.
          before: async (user) => (isAdmin(user.email, options.adminEmail) ? undefined : false),
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
