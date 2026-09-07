const ENTRY_PREFIX = "anime:";
const PENDING_UPDATES_KEY = "meta:pendingUpdates";
const PENDING_DELETES_KEY = "meta:pendingDeletes";

export function entryKey(anilistId) {
  return `${ENTRY_PREFIX}${Number(anilistId)}`;
}

export function createStorageAdapter(browserApi) {
  if (!browserApi?.storage?.local || !browserApi?.storage?.sync) {
    throw new Error("Browser extension storage is unavailable.");
  }

  const local = browserApi.storage.local;
  const sync = browserApi.storage.sync;

  return {
    async loadEntries() {
      const localData = await local.get(null);
      let pendingUpdates = toIdSet(localData[PENDING_UPDATES_KEY]);
      let pendingDeletes = toIdSet(localData[PENDING_DELETES_KEY]);
      let syncData;
      let syncStatus = "synced";

      try {
        syncData = await sync.get(null);

        if (pendingDeletes.size) {
          try {
            await sync.remove([...pendingDeletes].map(entryKey));
            for (const id of pendingDeletes) {
              delete syncData[entryKey(id)];
            }
            pendingDeletes = new Set();
            await writeIdSet(local, PENDING_DELETES_KEY, pendingDeletes);
          } catch {
            syncStatus = "local-only";
          }
        }

        if (pendingUpdates.size) {
          const retryPayload = {};
          for (const id of pendingUpdates) {
            const key = entryKey(id);
            if (isEntry(localData[key])) {
              retryPayload[key] = localData[key];
            }
          }
          try {
            if (Object.keys(retryPayload).length) {
              await sync.set(retryPayload);
              Object.assign(syncData, retryPayload);
            }
            pendingUpdates = new Set();
            await writeIdSet(local, PENDING_UPDATES_KEY, pendingUpdates);
          } catch {
            syncStatus = "local-only";
          }
        }
      } catch {
        syncData = null;
        syncStatus = "local-only";
      }

      const merged = new Map();
      if (syncData) {
        for (const [key, value] of Object.entries(syncData)) {
          if (key.startsWith(ENTRY_PREFIX) && isEntry(value)) {
            merged.set(value.anilistId, value);
          }
        }
        for (const id of pendingUpdates) {
          const localEntry = localData[entryKey(id)];
          if (isEntry(localEntry)) {
            merged.set(localEntry.anilistId, localEntry);
          }
        }
      } else {
        for (const [key, value] of Object.entries(localData)) {
          if (key.startsWith(ENTRY_PREFIX) && isEntry(value)) {
            merged.set(value.anilistId, value);
          }
        }
      }

      for (const id of pendingDeletes) {
        merged.delete(id);
      }

      if (syncData) {
        await refreshLocalMirror(local, localData, merged, pendingUpdates);
      }

      return { entries: [...merged.values()], syncStatus };
    },

    async saveEntry(entry) {
      const key = entryKey(entry.anilistId);
      await local.set({ [key]: entry });
      await updatePendingId(local, PENDING_DELETES_KEY, entry.anilistId, false);
      await updatePendingId(local, PENDING_UPDATES_KEY, entry.anilistId, true);

      try {
        await sync.set({ [key]: entry });
        await updatePendingId(local, PENDING_UPDATES_KEY, entry.anilistId, false);
        return "synced";
      } catch {
        return "local-only";
      }
    },

    async removeEntry(anilistId) {
      const key = entryKey(anilistId);
      await local.remove(key);
      await updatePendingId(local, PENDING_UPDATES_KEY, anilistId, false);
      await updatePendingId(local, PENDING_DELETES_KEY, anilistId, true);

      try {
        await sync.remove(key);
        await updatePendingId(local, PENDING_DELETES_KEY, anilistId, false);
        return "synced";
      } catch {
        return "local-only";
      }
    },
  };
}

async function refreshLocalMirror(local, previousLocalData, merged, pendingUpdates) {
  const mirrorPayload = {};
  const expectedKeys = new Set();
  for (const entry of merged.values()) {
    const key = entryKey(entry.anilistId);
    expectedKeys.add(key);
    mirrorPayload[key] = entry;
  }

  if (Object.keys(mirrorPayload).length) {
    await local.set(mirrorPayload);
  }

  const staleKeys = Object.keys(previousLocalData).filter((key) => {
    if (!key.startsWith(ENTRY_PREFIX) || expectedKeys.has(key)) {
      return false;
    }
    const id = Number(key.slice(ENTRY_PREFIX.length));
    return !pendingUpdates.has(id);
  });
  if (staleKeys.length) {
    await local.remove(staleKeys);
  }
}

async function updatePendingId(area, key, id, shouldInclude) {
  const data = await area.get(key);
  const ids = toIdSet(data[key]);
  if (shouldInclude) {
    ids.add(Number(id));
  } else {
    ids.delete(Number(id));
  }
  await writeIdSet(area, key, ids);
}

async function writeIdSet(area, key, ids) {
  if (ids.size) {
    await area.set({ [key]: [...ids] });
  } else {
    await area.remove(key);
  }
}

function toIdSet(value) {
  return new Set(Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []);
}

function isEntry(value) {
  return value
    && typeof value === "object"
    && Number.isFinite(Number(value.anilistId))
    && typeof value.title === "string"
    && Number.isFinite(Number(value.updatedAt));
}
