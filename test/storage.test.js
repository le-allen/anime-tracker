import assert from "node:assert/strict";
import test from "node:test";

import { createStorageAdapter, entryKey } from "../extension/modules/storage.js";
import { createMockBrowser, sampleEntry } from "./helpers/mock-browser.js";

test("loads Sync entries and refreshes the local mirror", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({ sync: { [entryKey(1)]: entry } });
  const adapter = createStorageAdapter(browser);

  const result = await adapter.loadEntries();

  assert.deepEqual(result, { entries: [entry], syncStatus: "synced" });
  assert.deepEqual(browser.storage.local.data[entryKey(1)], entry);
});

test("saves locally first and clears pending state after Sync succeeds", async () => {
  const entry = sampleEntry({ watchedEpisodes: 4 });
  const browser = createMockBrowser();
  const adapter = createStorageAdapter(browser);

  assert.equal(await adapter.saveEntry(entry), "synced");
  assert.deepEqual(browser.storage.local.data[entryKey(1)], entry);
  assert.deepEqual(browser.storage.sync.data[entryKey(1)], entry);
  assert.equal(browser.storage.local.data["meta:pendingUpdates"], undefined);
});

test("retains failed Sync writes locally and retries on the next load", async () => {
  const entry = sampleEntry({ watchedEpisodes: 7 });
  const browser = createMockBrowser({ syncFailures: { set: 1 } });
  const adapter = createStorageAdapter(browser);

  assert.equal(await adapter.saveEntry(entry), "local-only");
  assert.deepEqual(browser.storage.local.data["meta:pendingUpdates"], [1]);

  const result = await adapter.loadEntries();
  assert.equal(result.syncStatus, "synced");
  assert.deepEqual(result.entries, [entry]);
  assert.deepEqual(browser.storage.sync.data[entryKey(1)], entry);
  assert.equal(browser.storage.local.data["meta:pendingUpdates"], undefined);
});

test("falls back to the local mirror when Sync cannot be read", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({
    local: { [entryKey(1)]: entry },
    syncFailures: { get: true },
  });
  const adapter = createStorageAdapter(browser);

  assert.deepEqual(await adapter.loadEntries(), { entries: [entry], syncStatus: "local-only" });
});

test("keeps a deletion marker when Sync removal fails and retries later", async () => {
  const entry = sampleEntry();
  const browser = createMockBrowser({
    local: { [entryKey(1)]: entry },
    sync: { [entryKey(1)]: entry },
    syncFailures: { remove: 1 },
  });
  const adapter = createStorageAdapter(browser);

  assert.equal(await adapter.removeEntry(1), "local-only");
  assert.deepEqual(browser.storage.local.data["meta:pendingDeletes"], [1]);

  const result = await adapter.loadEntries();
  assert.deepEqual(result.entries, []);
  assert.equal(result.syncStatus, "synced");
  assert.equal(browser.storage.sync.data[entryKey(1)], undefined);
  assert.equal(browser.storage.local.data["meta:pendingDeletes"], undefined);
});

test("honors a remote deletion when there is no pending local update", async () => {
  const oldMirror = sampleEntry();
  const browser = createMockBrowser({ local: { [entryKey(1)]: oldMirror } });
  const adapter = createStorageAdapter(browser);

  const result = await adapter.loadEntries();
  assert.deepEqual(result.entries, []);
  assert.equal(browser.storage.local.data[entryKey(1)], undefined);
});

