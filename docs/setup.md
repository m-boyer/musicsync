# Setup guide

This guide takes you from a fresh install to a working sync. It assumes the app is running and you can sign in (see the [README](../README.md#quick-start)).

## 1. Add your credentials

Open **Credentials**. Each service needs a value copied from its web player while you are signed in. Values are stored encrypted and never shown again; to replace one, save it again.

### Apple Music

1. Sign in on [music.apple.com](https://music.apple.com).
2. Open the browser's developer tools and go to **Application → Cookies → https://music.apple.com**.
3. Copy the value of the `media-user-token` cookie and save it in musicsync.

The token lasts about 180 days. The home page warns you when it is getting old.

musicsync also needs Apple's developer token, which it reads from the Apple Music web player on its own. You do not need an Apple developer account.

### YouTube Music

1. Open a private browser window and sign in on [music.youtube.com](https://music.youtube.com).
2. Open the developer tools, go to **Network**, and pick any request to `/youtubei/`.
3. Copy the full value of the `Cookie` request header and save it in musicsync.
4. Close the private window without signing out. Signing out would end the session that musicsync uses.

If the cookie stops working, the sync reports that the YouTube session is not valid. Save a new one.

## 2. Choose the playlists

Open **Playlists**. For each service, choose one of your playlists or create a new one. Only playlists you can edit are listed, and playlists created on YouTube Music are private.

Changing either playlist later starts the pair over: the saved links are cleared, the mode goes back to `dry-run`, and the add and remove test must pass again.

## 3. Set your country

Open **Settings** and set **Apple Music country** to your two-letter storefront, such as `us`, `gb` or `ar`. Songs are searched in that country's catalog.

## 4. Run the tests

Open **Tests**.

1. **Read test:** reads both chosen playlists. On Apple Music it also tries each known API host and token header, and shows which ones work. Pick the one to use with **Use this combination**.
2. **Add and remove test:** enter a song that is in neither playlist. The test adds it to each playlist, checks that it appears, removes it, and checks that it is gone. It never touches a song that is already there.

Removing songs from an Apple Music playlist is not documented, so the test tries each known method and saves the one that works. `full` mode stays locked until removing works on both services.

## 5. Start syncing

The app starts in `dry-run`, which only records what it would do.

1. Wait for a cycle or press **Sync now** on the home page.
2. Open **History** and check what it would add or remove.
3. Review **Pending** for songs without a confident match. You can retry the search, pick the right song by hand, or ignore it.
4. When the plan looks right, switch to `add-only` in **Settings**.
5. Once `add-only` has run well for a few cycles, you can switch to `full` so removals are copied too. You must confirm this explicitly.

## Deployment

musicsync runs as a single container next to a Postgres database.

```bash
docker build -t musicsync --build-arg APP_REVISION=$(git rev-parse HEAD) .
docker run -p 3000:3000 --env-file .env musicsync
```

- Set the variables listed in the [README](../README.md#configuration). `BETTER_AUTH_URL` must match the public URL you open in the browser.
- Serve it over HTTPS behind a reverse proxy. Session cookies are secure in production.
- Database migrations run when the server starts.
- `GET /health` returns `{"status":"ok","revision":"…"}` once the app is ready, and an error status before that. The container's health check uses it.
- Run a single instance. The sync loop and its lock live in the process.

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) is the author's own pipeline: it builds the image to GitHub Container Registry and deploys it to Coolify through a shared workflow. Adapt or remove it for your own setup.

## Troubleshooting

| Problem | What to do |
|---|---|
| The sync says credentials are missing | Save both credentials in **Credentials**. |
| "The YouTube session is not valid" | Save a new YouTube cookie, taken from a private window as described above. |
| Apple Music returns 401 or 403 | The `media-user-token` expired or is wrong. Save a new one, then run the read test. |
| "Saved credentials cannot be decrypted" | `APP_ENCRYPTION_KEY` changed. Save both credentials again. |
| A cycle is **Blocked** | A read failed, did not finish, or came back empty while songs were linked. Nothing was changed. Check the reason in **History**; it usually clears on the next cycle. |
| "Nothing was removed: the per-cycle limit was exceeded" | More songs than **Max removals per cycle** would have been removed. Check the playlists, then raise the limit if the removals are intended. |
| `full` cannot be selected | Run the add and remove test until removing works on both services. |
