import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createPopupApp } from "../extension/popup/popup.js";
import { entryKey } from "../extension/modules/storage.js";
import { createMockBrowser, sampleEntry } from "./helpers/mock-browser.js";

const popupHtml = await readFile(new URL("../extension/popup/index.html", import.meta.url), "utf8");

function setup({ browser = createMockBrowser(), fetchImpl = async () => new Response() } = {}) {
  const dom = new JSDOM(popupHtml, { url: "https://extension.invalid/popup/index.html" });
  const app = createPopupApp({
    doc: dom.window.document,
    browserApi: browser,
    fetchImpl,
  });
  return { app, browser, document: dom.window.document, window: dom.window };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function searchResponse(media) {
  return new Response(JSON.stringify({ data: { Page: { media } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("renders a persisted entry and updates progress from the controls", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({ sync: { [entryKey(1)]: entry } });
  const { app, document } = setup({ browser });
  await app.init();

  assert.match(document.querySelector("#entry-summary").textContent, /1 anime/);
  assert.equal(document.querySelector(".card-title").textContent, "Cowboy Bebop");

  document.querySelector('[data-action="increment"]').click();
  await settle();
  assert.equal(app.state.entries[0].watchedEpisodes, 1);
  assert.equal(document.querySelector(".progress-count").textContent, "1 / 26");
});

test("filters entries by automatically derived status", async () => {
  const planned = sampleEntry({ anilistId: 1, title: "Planned" });
  const complete = sampleEntry({ anilistId: 2, title: "Complete", watchedEpisodes: 26 });
  const browser = createMockBrowser({
    sync: { [entryKey(1)]: planned, [entryKey(2)]: complete },
  });
  const { app, document } = setup({ browser });
  await app.init();

  document.querySelector('[data-filter="completed"]').click();
  assert.deepEqual([...document.querySelectorAll(".card-title")].map((node) => node.textContent), ["Complete"]);
});

test("searches, adds a result, and changes duplicate action to update", async () => {
  const fetchImpl = async () => searchResponse([{
    id: 1,
    title: { english: "Cowboy Bebop", romaji: "Cowboy Bebop", native: null },
    coverImage: { large: "cover.jpg", medium: "cover-small.jpg" },
    episodes: 26,
    format: "TV",
    seasonYear: 1998,
    status: "FINISHED",
  }]);
  const { app, document } = setup({ fetchImpl });
  await app.init();
  await app.performSearch("Bebop");

  assert.equal(document.querySelector(".result-title").textContent, "Cowboy Bebop");
  assert.equal(document.querySelector(".result-action").textContent, "Add");

  document.querySelector(".result-action").click();
  await settle();
  assert.equal(app.state.entries.length, 1);
  assert.equal(document.querySelector(".result-action").textContent, "Update");
});

test("requires explicit confirmation before removing an entry", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({ sync: { [entryKey(1)]: entry } });
  const { app, document } = setup({ browser });
  await app.init();

  document.querySelector('[data-action="remove"]').click();
  assert.ok(document.querySelector('[data-action="confirm-remove"]'));
  assert.equal(app.state.entries.length, 1);

  document.querySelector('[data-action="confirm-remove"]').click();
  await settle();
  assert.equal(app.state.entries.length, 0);
});

test("saves and clears an episode pause point without changing watched progress", async () => {
  const entry = sampleEntry({ watchedEpisodes: 4 });
  const browser = createMockBrowser({ sync: { [entryKey(1)]: entry } });
  const { app, document } = setup({ browser });
  await app.init();

  document.querySelector('[data-action="edit-pause"]').click();
  const episodeInput = document.querySelector("[data-pause-episode]");
  const timeInput = document.querySelector("[data-pause-time]");
  assert.equal(episodeInput.value, "5");
  episodeInput.value = "5";
  timeInput.value = "12:34";
  document.querySelector('[data-action="save-pause"]').click();
  await settle();

  assert.equal(app.state.entries[0].pausedEpisode, 5);
  assert.equal(app.state.entries[0].pausedAtSeconds, 754);
  assert.equal(app.state.entries[0].watchedEpisodes, 4);
  assert.match(document.querySelector(".pause-summary").textContent, /episode 5 · 12:34/);

  document.querySelector('[data-action="edit-pause"]').click();
  document.querySelector('[data-action="clear-pause"]').click();
  await settle();
  assert.equal(app.state.entries[0].pausedEpisode, null);
  assert.equal(document.querySelector(".pause-empty").textContent, "No pause point saved");
});

test("shows validation errors while editing an invalid pause point", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({ sync: { [entryKey(1)]: entry } });
  const { app, document } = setup({ browser });
  await app.init();

  document.querySelector('[data-action="edit-pause"]').click();
  document.querySelector("[data-pause-episode]").value = "27";
  document.querySelector("[data-pause-time]").value = "12:99";
  document.querySelector('[data-action="save-pause"]').click();
  await settle();

  assert.equal(app.state.entries[0].pausedEpisode, undefined);
  assert.equal(document.querySelector(".pause-error").hidden, false);
  assert.match(document.querySelector(".pause-error").textContent, /between 1 and 26/);
});

test("saves, opens, validates, and clears an anime watch link", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({ sync: { [entryKey(1)]: entry } });
  const { app, document } = setup({ browser });
  await app.init();

  document.querySelector('[data-action="edit-watch-link"]').click();
  const input = document.querySelector("[data-watch-url]");
  input.value = "not a link";
  document.querySelector('[data-action="save-watch-link"]').click();
  await settle();
  assert.equal(document.querySelector(".watch-link-error").hidden, false);
  assert.equal(app.state.entries[0].watchUrl, undefined);

  input.value = "https://watch.example/anime/cowboy-bebop";
  document.querySelector('[data-action="save-watch-link"]').click();
  await settle();

  assert.equal(app.state.entries[0].watchUrl, "https://watch.example/anime/cowboy-bebop");
  const link = document.querySelector(".watch-link");
  assert.equal(link.href, "https://watch.example/anime/cowboy-bebop");
  assert.equal(link.target, "_blank");
  assert.match(link.getAttribute("rel"), /noopener/);

  document.querySelector('[data-action="edit-watch-link"]').click();
  document.querySelector('[data-action="clear-watch-link"]').click();
  await settle();
  assert.equal(app.state.entries[0].watchUrl, "");
  assert.equal(document.querySelector(".watch-link-empty").textContent, "No watch link saved");
});

test("shows local fallback and AniList error states", async () => {
  const browser = createMockBrowser({ syncFailures: { get: true } });
  const { app, document } = setup({
    browser,
    fetchImpl: async () => { throw new TypeError("offline"); },
  });
  await app.init();
  assert.equal(document.querySelector("#sync-notice").hidden, false);

  await app.performSearch("Bebop");
  assert.match(document.querySelector("#search-status").textContent, /Could not reach AniList/);
  assert.equal(document.querySelector("#retry-search").hidden, false);
});
