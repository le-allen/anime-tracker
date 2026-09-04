import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPausePoint,
  chooseTitle,
  createEntry,
  deriveStatus,
  filterAndSortEntries,
  formatTimestamp,
  hasPausePoint,
  parseTimestamp,
  progressPercent,
  setPausePoint,
  setWatchedEpisodes,
  updateEntryMetadata,
} from "../extension/modules/model.js";
import { sampleEntry } from "./helpers/mock-browser.js";

test("chooses English, Romaji, native, then a safe fallback title", () => {
  assert.equal(chooseTitle({ english: "English", romaji: "Romaji", native: "Native" }), "English");
  assert.equal(chooseTitle({ romaji: "Romaji", native: "Native" }), "Romaji");
  assert.equal(chooseTitle({ native: "Native" }), "Native");
  assert.equal(chooseTitle({}), "Untitled anime");
});

test("creates a compact, versioned entry from AniList metadata", () => {
  const entry = createEntry({
    id: 1,
    title: { english: "Cowboy Bebop" },
    coverUrl: "cover.jpg",
    episodes: 26,
    format: "TV",
    seasonYear: 1998,
    status: "FINISHED",
  }, 1234);

  assert.deepEqual(entry, {
    schemaVersion: 2,
    anilistId: 1,
    title: "Cowboy Bebop",
    coverUrl: "cover.jpg",
    totalEpisodes: 26,
    watchedEpisodes: 0,
    pausedEpisode: null,
    pausedAtSeconds: null,
    format: "TV",
    seasonYear: 1998,
    releaseStatus: "FINISHED",
    addedAt: 1234,
    updatedAt: 1234,
  });
});

test("clamps progress and derives list status", () => {
  const planned = sampleEntry();
  const watching = setWatchedEpisodes(planned, 5, 200);
  const completed = setWatchedEpisodes(watching, 99, 300);

  assert.equal(deriveStatus(planned), "planned");
  assert.equal(deriveStatus(watching), "watching");
  assert.equal(deriveStatus(completed), "completed");
  assert.equal(completed.watchedEpisodes, 26);
  assert.equal(setWatchedEpisodes(watching, -4, 400).watchedEpisodes, 0);
  assert.equal(progressPercent(watching), 19);
});

test("supports unbounded progress when AniList has no episode total", () => {
  const entry = sampleEntry({ totalEpisodes: null });
  const updated = setWatchedEpisodes(entry, 104, 200);
  assert.equal(updated.watchedEpisodes, 104);
  assert.equal(deriveStatus(updated), "watching");
  assert.equal(progressPercent(updated), 0);
});

test("refreshes metadata without losing watched progress", () => {
  const existing = sampleEntry({ watchedEpisodes: 12, pausedEpisode: 13, pausedAtSeconds: 754 });
  const updated = updateEntryMetadata(existing, {
    id: 1,
    title: { english: "Cowboy Bebop (Updated)" },
    coverUrl: "new-cover.jpg",
    episodes: 26,
    format: "TV",
    seasonYear: 1998,
    status: "FINISHED",
  }, 999);

  assert.equal(updated.watchedEpisodes, 12);
  assert.equal(updated.pausedEpisode, 13);
  assert.equal(updated.pausedAtSeconds, 754);
  assert.equal(updated.title, "Cowboy Bebop (Updated)");
  assert.equal(updated.updatedAt, 999);
});

test("sets, formats, and clears an episode pause point", () => {
  const entry = sampleEntry({ watchedEpisodes: 4 });
  const paused = setPausePoint(entry, "5", "12:34", 500);

  assert.equal(paused.schemaVersion, 2);
  assert.equal(paused.pausedEpisode, 5);
  assert.equal(paused.pausedAtSeconds, 754);
  assert.equal(paused.watchedEpisodes, 4);
  assert.equal(paused.updatedAt, 500);
  assert.equal(hasPausePoint(paused), true);
  assert.equal(formatTimestamp(paused.pausedAtSeconds), "12:34");

  const cleared = clearPausePoint(paused, 600);
  assert.equal(cleared.pausedEpisode, null);
  assert.equal(cleared.pausedAtSeconds, null);
  assert.equal(hasPausePoint(cleared), false);
});

test("supports hour timestamps and rejects invalid pause points", () => {
  assert.equal(parseTimestamp("1:02:03"), 3723);
  assert.equal(formatTimestamp(3723), "1:02:03");
  assert.equal(parseTimestamp("72:05"), 4325);
  assert.equal(parseTimestamp("4:90"), null);
  assert.equal(parseTimestamp("1:70:00"), null);
  assert.equal(parseTimestamp("90"), null);

  const entry = sampleEntry();
  assert.throws(() => setPausePoint(entry, 0, "12:34"), /episode number/);
  assert.throws(() => setPausePoint(entry, 27, "12:34"), /between 1 and 26/);
  assert.throws(() => setPausePoint(entry, 5, "not a time"), /timestamp/);
});

test("treats older stored entries without pause fields as having no pause point", () => {
  const oldEntry = sampleEntry({ schemaVersion: 1 });
  assert.equal(hasPausePoint(oldEntry), false);
  assert.equal(clearPausePoint(oldEntry), oldEntry);
});

test("filters by derived status and sorts by recent updates", () => {
  const entries = [
    sampleEntry({ anilistId: 1, title: "Planned", watchedEpisodes: 0, updatedAt: 300 }),
    sampleEntry({ anilistId: 2, title: "Watching", watchedEpisodes: 4, updatedAt: 100 }),
    sampleEntry({ anilistId: 3, title: "Complete", watchedEpisodes: 26, updatedAt: 200 }),
  ];

  assert.deepEqual(filterAndSortEntries(entries).map((entry) => entry.title), [
    "Planned",
    "Complete",
    "Watching",
  ]);
  assert.deepEqual(filterAndSortEntries(entries, "watching").map((entry) => entry.title), ["Watching"]);
});
