import { z } from 'zod';

const optional = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const schema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  YT_COOKIE: z.string().trim().min(1),
  APPLE_MEDIA_USER_TOKEN: z.string().trim().min(1),
  APPLE_STOREFRONT: z.string().trim().toLowerCase().length(2).default('us'),
  APPLE_BASE_URL: optional,
  APPLE_USER_TOKEN_HEADER: z.enum(['Music-User-Token', 'media-user-token']).default('Music-User-Token'),
  SYNC_MODE: z.enum(['dry-run', 'add-only', 'full']).default('dry-run'),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_OPS_PER_CYCLE: z.coerce.number().int().positive().default(25),
  MAX_DELETES_PER_CYCLE: z.coerce.number().int().nonnegative().default(5),
  ADD_GRACE_MINUTES: z.coerce.number().positive().default(30),
  MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_REVISION: z.string().trim().default('unknown'),
});

export type Config = z.infer<typeof schema>;
export type SyncMode = Config['SYNC_MODE'];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Field names only: the values include account credentials.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return parsed.data;
}
