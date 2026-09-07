export class MemoryStorageArea {
  constructor(initial = {}, failures = {}) {
    this.data = structuredClone(initial);
    this.failures = { ...failures };
  }

  async get(query = null) {
    this.#maybeFail("get");
    if (query === null || query === undefined) {
      return structuredClone(this.data);
    }
    if (typeof query === "string") {
      return Object.hasOwn(this.data, query) ? { [query]: structuredClone(this.data[query]) } : {};
    }
    if (Array.isArray(query)) {
      return Object.fromEntries(query
        .filter((key) => Object.hasOwn(this.data, key))
        .map((key) => [key, structuredClone(this.data[key])]));
    }
    return Object.fromEntries(Object.entries(query).map(([key, fallback]) => [
      key,
      Object.hasOwn(this.data, key) ? structuredClone(this.data[key]) : fallback,
    ]));
  }

  async set(values) {
    this.#maybeFail("set");
    Object.assign(this.data, structuredClone(values));
  }

  async remove(keys) {
    this.#maybeFail("remove");
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.data[key];
    }
  }

  #maybeFail(method) {
    if (!this.failures[method]) return;
    if (typeof this.failures[method] === "number") {
      this.failures[method] -= 1;
    }
    throw new Error(`${method} failed`);
  }
}

export function createMockBrowser({
  local = {},
  sync = {},
  syncFailures = {},
  activeTab = { title: "Cowboy Bebop - Episode 1", url: "https://watch.example/anime/cowboy-bebop" },
} = {}) {
  return {
    tabs: {
      async query() {
        return activeTab ? [structuredClone(activeTab)] : [];
      },
    },
    storage: {
      local: new MemoryStorageArea(local),
      sync: new MemoryStorageArea(sync, syncFailures),
    },
  };
}

export function sampleEntry(overrides = {}) {
  return {
    schemaVersion: 1,
    anilistId: 1,
    title: "Cowboy Bebop",
    coverUrl: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg",
    totalEpisodes: 26,
    watchedEpisodes: 0,
    format: "TV",
    seasonYear: 1998,
    releaseStatus: "FINISHED",
    addedAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}
