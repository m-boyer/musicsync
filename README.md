# musicsync

Keeps one Apple Music playlist and one YouTube Music playlist in sync, in both directions. Add a song to either playlist and it shows up in the other. With removals turned on, removing one removes it from the other too.

It is a small self-hosted Next.js app with Postgres. It runs the sync every few minutes and has a web panel to manage it.

> [!WARNING]
> Neither service offers a public API for this. musicsync uses the private APIs that the Apple Music and YouTube Music web players use, through [a fork of applemusic-api](https://github.com/MatiasBoyer/applemusic-api) and [YouTube.js](https://github.com/LuanRT/YouTube.js). They can change or stop working without notice. Use it with your own accounts, at your own risk.

## Features

- **Pick or create the playlists** to sync on each service from the web.
- **Two-way sync** that remembers which songs it already linked, so it can tell a new song from a removed one.
- **Song matching** by title, artist and duration, with a review screen for songs without a confident match.
- **Three modes:** simulate (`dry-run`), add only (`add-only`), and add and remove (`full`).
- **Safety limits:** a cycle that cannot read a playlist, or would remove too many songs, changes nothing.
- **Built-in tests** that check what each service allows from your server before you turn on removals.
- **Encrypted credentials:** tokens are stored encrypted in Postgres and never shown again.
- **One account,** with sign-up disabled and rate-limited sign-in.

## Quick start

You need Node.js 22 or later and Postgres.

```bash
git clone https://github.com/m-boyer/musicsync.git
cd musicsync
npm ci
cp .env.example .env.local
```

Fill in `.env.local` (see [Configuration](#configuration)), then start the app:

```bash
npm run dev
```

Open http://localhost:3000, sign in with `ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`, and follow [the setup guide](docs/setup.md) to add your credentials and choose the playlists.

To run it in production, see [Deployment](docs/setup.md#deployment).

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string. Stores the sync state, settings, encrypted credentials and sessions. |
| `APP_ENCRYPTION_KEY` | Yes | 32 random bytes in base64: `openssl rand -base64 32`. Encrypts the saved credentials. If it changes, save them again. |
| `BETTER_AUTH_SECRET` | Yes | At least 32 characters: `openssl rand -base64 32`. Signs sessions. |
| `BETTER_AUTH_URL` | Yes | The app's public URL, for example `https://musicsync.example.com`. |
| `ADMIN_EMAIL` | Yes | The only account that can sign in. |
| `INITIAL_ADMIN_PASSWORD` | First start | Creates the account the first time, with at least 12 characters. It is never used again, so you can remove it afterwards and change the password from Settings. |
| `SENTRY_DSN` | No | Error reporting. |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn` or `error`. |

Everything else is set from the web panel.

## Documentation

- [Setup guide](docs/setup.md): credentials, choosing playlists, the first sync and deployment.
- [How it works](docs/how-it-works.md): the sync cycle, matching, modes and safety rules.

## Development

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
```

The sync logic lives in `src/sync`, the service clients in `src/providers`, and the web panel in `app`. Database migrations are in `migrations` and run when the server starts.

## License

[MIT](LICENSE)

musicsync is not affiliated with Apple or Google. Apple Music and YouTube Music are trademarks of their respective owners.
