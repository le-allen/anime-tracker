# Anime Episode Tracker

A small Firefox and Chrome extension for finding anime through AniList and tracking watched episodes from the toolbar.

## Features

- Search AniList without creating an account.
- Add anime and increment, decrement, or directly edit episode progress.
- Save the exact episode and timestamp where you paused, then edit or clear the resume point later.
- Save a link to the page where you watch each anime and open it directly from the tracker.
- Automatically group titles as Planned, Watching, or Completed.
- Save each title with browser sync and retain a local fallback when sync is unavailable.
- Follow the browser's light or dark theme.

## Saving a pause point

On an anime card, select **Set pause point**, enter the episode number and a timestamp such as `12:34` or `1:02:03`, and select **Save**. The resume point is stored separately from completed-episode progress and can be edited or cleared at any time.

## Development

Requirements: Node.js 20 or later, plus Firefox 128 or later or Chrome 95 or later.

```sh
npm install
npm test
npm run lint
npm start
npm run start:chrome
```

`npm start` launches a temporary Firefox profile with the extension loaded. You can also open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and open `extension/manifest.json`.

`npm run start:chrome` launches the extension in Chromium. To load it manually in Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the `extension/` directory.

Build a distributable ZIP with:

```sh
npm run build
```

The archive is written to `web-ext-artifacts/`. Regular Firefox builds require Mozilla signing before a packaged extension can be permanently installed; Chrome can load the unpacked `extension/` directory during development.

## Data and permissions

The extension requests only:

- `storage`, to save progress in the browser's synchronized storage and keep a local fallback mirror.
- `activeTab`, to capture the current page's URL and title when **Add link** is selected.
- Access to `https://graphql.anilist.co/*`, to search anime metadata.

Search terms are sent to AniList, and cover artwork is loaded from URLs returned by AniList. No account credentials, browsing history, analytics, or telemetry are collected. Browser sync must be enabled to carry progress between profiles in the same browser ecosystem.

## Project layout

- `extension/manifest.json` — shared Firefox and Chrome Manifest V3 configuration.
- `extension/popup/` — toolbar popup UI and interactions.
- `extension/modules/` — AniList client, domain model, and storage adapter.
- `test/` — automated model, API, storage, and popup tests.
