# musicsync

Keeps your Apple Music library songs and your YouTube Music likes the same, every 5 minutes.

- **Apple Music:** [fork of applemusic-api](https://github.com/MatiasBoyer/applemusic-api).
- **YouTube Music:** [YouTube.js](https://github.com/LuanRT/YouTube.js).

Both use unofficial interfaces, which can stop working without notice.

## Modes

Set with `SYNC_MODE`:

| Mode | What it does |
|---|---|
| `dry-run` (default) | Reads, links songs already on both sides, and records what it would do. |
| `add-only` | Adds new songs in both directions. |
| `full` | Also replicates deletions. |

## Safety rules

- A cycle changes nothing if a read fails, does not finish, or returns empty for a service that had linked songs.
- A song is only deleted if it was seen on both sides and then removed from one, so the first cycle never deletes.
- `MAX_DELETES_PER_CYCLE` blocks the whole batch of deletions if exceeded.
- `MAX_OPS_PER_CYCLE` limits searches and additions per cycle, so the first load happens in batches.
- A recently added song is not treated as deleted for `ADD_GRACE_MINUTES`.
- Songs with a doubtful match stay in `match_results` as `pending` and are not retried.

## Credentials

Configure them as environment variables (see `.env.example`). Never commit them.

- `YT_COOKIE`: the `Cookie` header of a request to `music.youtube.com` while signed in.
- `APPLE_MEDIA_USER_TOKEN`: the `media-user-token` cookie on `music.apple.com`. It expires after about 180 days.

When one expires, the cycle fails with an error in Sentry and changes nothing. `/health` stays green on purpose, so it does not block deploys or restart the container.

## Checking what each service allows

```bash
npm run probe:dev
```

This only reads. To also add and remove one test song on each service:

```bash
PROBE_QUERY="a song you do not have" npx tsx --env-file=.env src/probe.ts --write
```

It refuses to touch a song you already have. Inside the container, use `node dist/probe.js`.

## Reviewing what it does

```sql
-- Last cycles, including planned additions and deletions.
SELECT started_at, mode, status, summary FROM sync_runs ORDER BY started_at DESC LIMIT 10;

-- Songs that could not be matched. Delete a row to retry that song.
SELECT service, title, artist, reason, target_title, target_artist, score
FROM match_results WHERE status = 'pending';
```

## Development

```bash
npm ci
npm run typecheck
npm run test:coverage
```

Pushing to `master` tests, builds and deploys through `m-boyer/Pipelines`.
