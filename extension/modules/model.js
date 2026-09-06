export const SCHEMA_VERSION = 3;
export const FILTERS = Object.freeze(["all", "planned", "watching", "completed"]);

export function chooseTitle(title = {}) {
  return title.english?.trim()
    || title.romaji?.trim()
    || title.native?.trim()
    || "Untitled anime";
}

export function createEntry(media, now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    anilistId: Number(media.id),
    title: chooseTitle(media.title),
    coverUrl: media.coverUrl || "",
    totalEpisodes: normalizeTotal(media.episodes),
    watchedEpisodes: 0,
    pausedEpisode: null,
    pausedAtSeconds: null,
    watchUrl: "",
    format: media.format || null,
    seasonYear: Number.isInteger(media.seasonYear) ? media.seasonYear : null,
    releaseStatus: media.status || null,
    addedAt: now,
    updatedAt: now,
  };
}

export function updateEntryMetadata(entry, media, now = Date.now()) {
  return {
    ...entry,
    schemaVersion: SCHEMA_VERSION,
    title: chooseTitle(media.title),
    coverUrl: media.coverUrl || entry.coverUrl || "",
    totalEpisodes: normalizeTotal(media.episodes),
    format: media.format || null,
    seasonYear: Number.isInteger(media.seasonYear) ? media.seasonYear : null,
    releaseStatus: media.status || null,
    updatedAt: now,
  };
}

export function setWatchedEpisodes(entry, requestedValue, now = Date.now()) {
  const parsed = Number(requestedValue);
  if (!Number.isFinite(parsed)) {
    return entry;
  }

  let watchedEpisodes = Math.max(0, Math.trunc(parsed));
  if (Number.isInteger(entry.totalEpisodes) && entry.totalEpisodes > 0) {
    watchedEpisodes = Math.min(watchedEpisodes, entry.totalEpisodes);
  }

  if (watchedEpisodes === entry.watchedEpisodes) {
    return entry;
  }

  return { ...entry, schemaVersion: SCHEMA_VERSION, watchedEpisodes, updatedAt: now };
}

export function setPausePoint(entry, requestedEpisode, requestedTimestamp, now = Date.now()) {
  const episode = Number(requestedEpisode);
  if (!Number.isSafeInteger(episode) || episode < 1) {
    throw new RangeError("Enter an episode number of 1 or greater.");
  }
  if (Number.isInteger(entry.totalEpisodes) && episode > entry.totalEpisodes) {
    throw new RangeError(`Episode must be between 1 and ${entry.totalEpisodes}.`);
  }

  const pausedAtSeconds = parseTimestamp(requestedTimestamp);
  if (pausedAtSeconds === null) {
    throw new RangeError("Enter a timestamp like 12:34 or 1:02:03.");
  }

  return {
    ...entry,
    schemaVersion: SCHEMA_VERSION,
    pausedEpisode: episode,
    pausedAtSeconds,
    updatedAt: now,
  };
}

export function clearPausePoint(entry, now = Date.now()) {
  if (!hasPausePoint(entry)) {
    return entry;
  }
  return {
    ...entry,
    schemaVersion: SCHEMA_VERSION,
    pausedEpisode: null,
    pausedAtSeconds: null,
    updatedAt: now,
  };
}

export function setWatchUrl(entry, requestedUrl, now = Date.now()) {
  const value = String(requestedUrl).trim();
  if (!value) {
    return clearWatchUrl(entry, now);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Enter a valid website link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("The watch link must start with http:// or https://.");
  }

  const watchUrl = url.href;
  if (watchUrl === entry.watchUrl) {
    return entry;
  }
  return { ...entry, schemaVersion: SCHEMA_VERSION, watchUrl, updatedAt: now };
}

export function clearWatchUrl(entry, now = Date.now()) {
  if (!entry.watchUrl) {
    return entry;
  }
  return { ...entry, schemaVersion: SCHEMA_VERSION, watchUrl: "", updatedAt: now };
}

export function hasPausePoint(entry) {
  return Number.isInteger(entry.pausedEpisode)
    && entry.pausedEpisode >= 1
    && Number.isInteger(entry.pausedAtSeconds)
    && entry.pausedAtSeconds >= 0;
}

export function parseTimestamp(value) {
  const parts = String(value).trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  const numbers = parts.map(Number);
  const seconds = numbers.at(-1);
  const minutes = numbers.at(-2);
  const hours = parts.length === 3 ? numbers[0] : 0;
  const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
  if (seconds > 59
    || (parts.length === 3 && minutes > 59)
    || !Number.isSafeInteger(totalSeconds)) {
    return null;
  }
  return totalSeconds;
}

export function formatTimestamp(totalSeconds) {
  const value = Number(totalSeconds);
  if (!Number.isInteger(value) || value < 0) {
    return "";
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function deriveStatus(entry) {
  if (entry.watchedEpisodes <= 0) {
    return "planned";
  }
  if (Number.isInteger(entry.totalEpisodes)
    && entry.totalEpisodes > 0
    && entry.watchedEpisodes >= entry.totalEpisodes) {
    return "completed";
  }
  return "watching";
}

export function filterAndSortEntries(entries, filter = "all") {
  const normalizedFilter = FILTERS.includes(filter) ? filter : "all";
  return entries
    .filter((entry) => normalizedFilter === "all" || deriveStatus(entry) === normalizedFilter)
    .toSorted((left, right) => (
      right.updatedAt - left.updatedAt || left.title.localeCompare(right.title)
    ));
}

export function progressPercent(entry) {
  if (!Number.isInteger(entry.totalEpisodes) || entry.totalEpisodes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((entry.watchedEpisodes / entry.totalEpisodes) * 100));
}

function normalizeTotal(value) {
  const total = Number(value);
  return Number.isInteger(total) && total > 0 ? total : null;
}
