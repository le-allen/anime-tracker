# Anime Episode Tracker

A small Firefox extension for finding anime through AniList and tracking watched episodes from the toolbar.

## Features

- Search AniList without creating an account.
- Add anime and increment, decrement, or directly edit episode progress.
- Save the exact episode and timestamp where you paused, then edit or clear the resume point later.
- Automatically group titles as Planned, Watching, or Completed.
- Save each title with Firefox Sync and retain a local fallback when Sync is unavailable.
- Follow the Firefox light or dark theme.

## Saving a pause point

On an anime card, select **Set pause point**, enter the episode number and a timestamp such as `12:34` or `1:02:03`, and select **Save**. The resume point is stored separately from completed-episode progress and can be edited or cleared at any time.

## Development

Requirements: Node.js 20 or later and Firefox 128 or later.

```sh
npm install
npm test
npm run lint
npm start
```

`npm start` launches a temporary Firefox profile with the extension loaded. You can also open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and open `extension/manifest.json`.

Build a distributable ZIP with:

```sh
npm run build
```

The archive is written to `web-ext-artifacts/`. Regular Firefox builds require Mozilla signing before a packaged extension can be permanently installed.

## Data and permissions

The extension requests only:

- `storage`, to save progress in `browser.storage.sync` and keep a fallback mirror in `browser.storage.local`.
- Access to `https://graphql.anilist.co/*`, to search anime metadata.

Search terms are sent to AniList, and cover artwork is loaded from URLs returned by AniList. No account credentials, browsing history, analytics, or telemetry are collected. Firefox Sync must be enabled for add-ons in Firefox settings to carry progress between desktop profiles. Firefox for Android does not currently synchronize extension storage.

## Project layout

- `extension/manifest.json` — Firefox Manifest V3 configuration.
- `extension/popup/` — toolbar popup UI and interactions.
- `extension/modules/` — AniList client, domain model, and storage adapter.
- `test/` — automated model, API, storage, and popup tests.
