# musicsync

Keeps your Apple Music library songs and your YouTube Music likes the same. A Next.js app runs the sync every few minutes and lets you manage it from the web.

- **Apple Music:** [fork of applemusic-api](https://github.com/MatiasBoyer/applemusic-api).
- **YouTube Music:** [YouTube.js](https://github.com/LuanRT/YouTube.js).

Both use unofficial interfaces, which can stop working without notice.

## What the web does

- **Inicio:** status, last and next cycle, and a button to sync now.
- **Credenciales:** load each service's token. They are stored encrypted and never shown again.
- **Pruebas:** check what each service allows from the server, and choose the Apple connection that works.
- **Ajustes:** mode, interval, limits and password. `full` is only allowed once the add and delete test passed on both services.
- **Historial:** recent cycles, with what was or would be added and deleted.
- **Pendientes:** songs without a safe match: retry, ignore or pick the right song.

## Access

There is a single account, `matiasboyer7@gmail.com`, managed with Better Auth. Sign up and password reset are disabled. The account is created on the first start from `INITIAL_ADMIN_PASSWORD`, and the password can then be changed from Ajustes. Sign in is limited to 5 attempts every 5 minutes.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres for state, settings, encrypted credentials and sessions. |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts the tokens. If it changes, load them again. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. Signs sessions. |
| `BETTER_AUTH_URL` | Public URL. Defaults to `https://musicsync.matiasboyer.com`. |
| `INITIAL_ADMIN_PASSWORD` | Creates the account the first time. At least 12 characters. |
| `SENTRY_DSN` | Optional error reporting. |

Everything else is set from the web.

## Modes

| Mode | What it does |
|---|---|
| `dry-run` (default) | Reads, links songs already on both sides, and records what it would do. |
| `add-only` | Adds new songs in both directions. |
| `full` | Also replicates deletions. |

## Safety rules

- A cycle changes nothing if a read fails, does not finish, or returns empty for a service that had linked songs.
- A song is only deleted if it was seen on both sides and then removed from one, so the first cycle never deletes.
- The maximum deletions per cycle blocks the whole batch if exceeded.
- The maximum operations per cycle makes the first load happen in batches.
- A recently added song is not treated as deleted during the grace period.
- An expired YouTube cookie is detected by reading the account, instead of looking like an empty list.
- Tokens never reach pages, logs, Sentry or the run history.

## Development

```bash
npm ci
npm run typecheck
npm run test:coverage
npm run dev
```

Pushing to `master` tests, builds and deploys through `m-boyer/Pipelines`. Migrations run when the server starts.
