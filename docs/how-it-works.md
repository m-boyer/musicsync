# How it works

## Overview

```
 Apple Music playlist ──read──┐                 ┌──read── YouTube Music playlist
                              ▼                 ▼
                         ┌──────────────────────────┐
                         │  sync cycle (every 5 min) │
                         │  compare with saved links │
                         └──────────────────────────┘
                              │                 │
                  add/remove ─┘                 └─ add/remove
                                      │
                                   Postgres
             links, match cache, run history, settings, encrypted credentials
```

The app is a Next.js server. When it starts, it runs the database migrations, creates the admin account if needed, and starts the sync loop in the same process. The web panel and the loop share one lock, so a cycle, a test and a playlist change never run at the same time.

## The sync cycle

Each cycle:

1. **Reads both playlists in full.** A repeated song counts once, and on YouTube Music only songs and music videos are kept.
2. **Compares them with the saved links.** A link records that a song on Apple Music and a song on YouTube Music are the same, and whether each side has been seen.
3. **Decides what changed** for each song:

   | Situation | Meaning |
   |---|---|
   | On one side, with no link | A new song: find it on the other service and add it. |
   | Linked, on both sides | Nothing to do. |
   | Linked, missing from a side where it was seen before | It was removed there: remove it from the other side (`full` only). |
   | Linked, never seen on the side it was added to | Still being added. After the grace period it moves to **Pending**. |
   | Linked, on neither side | Removed from both: the link is forgotten. |

4. **Applies the changes** allowed by the current mode, within the per-cycle limits.
5. **Records the run** in **History**, with counts and a sample of the songs.

Because removals are detected from saved links, the first cycle for a pair never removes anything. When both playlists already have songs, the first sync merges them.

Only the songs are synced, not their order.

## Matching songs

A new song is searched on the other service by title and artist. Each result gets a score from 0 to 1:

- **Title and artist** are compared word by word, after removing accents, punctuation, "feat." credits and YouTube's "- Topic" suffix.
- **Duration** counts when both services report it: a close duration raises the score, and a very different one lowers it.
- **Versions** such as live, remix, acoustic or instrumental are penalized unless both titles say so.

The best result is used if its score reaches the **Match threshold** (0.8 by default). Otherwise the song goes to **Pending**, where you can pick the right result by hand or ignore it. Search results are cached, so a song is not searched again every cycle.

Before searching, songs that are already on both sides and match each other are linked directly, without a search.

## Modes

| Mode | Adds | Removes |
|---|---|---|
| `dry-run` | No, only records what it would add | No, only records what it would remove |
| `add-only` | Yes | No |
| `full` | Yes | Yes |

`full` can only be selected after the add and remove test succeeds on both chosen playlists, and requires an explicit confirmation.

## Safety rules

- **Untrusted reads change nothing.** If a read fails, does not finish, or returns an empty playlist for a side that had linked songs, the cycle is blocked.
- **Removal limit.** If a cycle would remove more songs than **Max removals per cycle** (5 by default), it removes none.
- **Operation limit.** **Operations per cycle** (25 by default) caps searches and additions, so a large first sync happens in batches.
- **Grace period.** A song added less than **Wait after adding** minutes ago (30 by default) is not treated as removed while the service catches up.
- **Expired sessions are detected.** An expired YouTube cookie can still look signed in and return empty lists, so musicsync checks the account before reading.
- **Changing a playlist starts over.** The saved links belong to the old pair, so they are cleared and the mode goes back to `dry-run`.

## Services

### Apple Music

musicsync calls the API used by the Apple Music web player, through [a fork of applemusic-api](https://github.com/MatiasBoyer/applemusic-api). The fork adds library playlists, adding and removing playlist tracks, and retries.

- The developer token is read from the web player; the user token is your `media-user-token`.
- There are two known API hosts and two names for the user token header. The read test shows which combinations work from your server.
- Removing tracks from a library playlist is not part of Apple's documented API. The add and remove test tries each known request and saves the one that works.
- Depending on your Apple Music settings, adding a song to a playlist may also add it to your library.

### YouTube Music

musicsync uses [YouTube.js](https://github.com/LuanRT/YouTube.js) with your browser cookie. It reads playlists through YouTube Music, and adds and removes videos through the playlist API. Playlists it creates are private.

## Data and security

- **Credentials** are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` before they are stored. They never reach the pages, logs, error reports or run history.
- **Authentication** uses [Better Auth](https://www.better-auth.com) with email and password. Only `ADMIN_EMAIL` can exist: sign-up, password reset and account changes are disabled, and sign-in is limited to 5 attempts every 5 minutes.
- **Every page and server action** checks the session on its own.

### Tables

| Table | Contents |
|---|---|
| `track_links` | Pairs of linked songs and when each side was last seen. |
| `match_results` | Search results, including pending and ignored songs. |
| `sync_runs` | History of cycles and their summaries. |
| `settings` | Mode, limits, chosen playlists and test results. |
| `credentials` | Encrypted service credentials. |
| `probe_runs` | Results of the tests. |
| `user`, `session`, `account`, `verification`, `rateLimit` | Better Auth. |
