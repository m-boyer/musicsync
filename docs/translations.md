# Translations

Every text in the web panel lives in one file per language:

| File | Language |
|---|---|
| [`src/i18n/messages/en.json`](../src/i18n/messages/en.json) | English, the reference |
| [`src/i18n/messages/es.json`](../src/i18n/messages/es.json) | Spanish |

## How the language is chosen

1. The language picked in the selector at the top of the panel, saved in a cookie for a year.
2. Otherwise, the browser's preferred languages, in order.
3. Otherwise, English.

## Message format

Messages are grouped by page, and code refers to them by path, such as `home.title`.

- **Parameters** go in braces: `"Token is {days} days old"`.
- **Plurals** are an object with `one` and `other`, chosen with the language's plural rules from the `count` parameter:

  ```json
  "songs": { "one": "{count} song", "other": "{count} songs" }
  ```

Test results and errors are saved in the database as a path with parameters, not as text, so they are shown in the language of whoever opens the page. Errors that come from Apple or YouTube are shown as the services return them.

## Checks

- **Type check:** code can only use paths that exist in `en.json`, and every language file must have every path.
- **Tests:** `test/i18n.test.ts` checks that every language has exactly the same paths as English, the same parameters in each message, and no empty text.

## Adding a language

1. Copy `en.json` to `<code>.json`, for example `pt.json`, and translate the values. Keep the paths and the `{parameters}` as they are.
2. In [`src/i18n/index.ts`](../src/i18n/index.ts), import the file, add the code to `LOCALES`, its name to `LOCALE_NAMES`, and the messages to `MESSAGES`.
3. Run `npm run typecheck` and `npm test`.

The code must be a two-letter language code, because the browser's language is matched on that part.
