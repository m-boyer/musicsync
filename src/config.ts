import { z } from 'zod';

const optional = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const schema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  APP_ENCRYPTION_KEY: z
    .string()
    .trim()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes in base64'),
  BETTER_AUTH_SECRET: z.string().trim().min(32),
  BETTER_AUTH_URL: z.string().trim().url(),
  // The only account that can exist.
  ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
  // Only used to create the account the first time. It can be removed afterwards.
  INITIAL_ADMIN_PASSWORD: optional,
  APP_REVISION: z.string().trim().default('unknown'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Field names only: the values are secrets.
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return parsed.data;
}
