import { searchAnime } from "../modules/anilist.js";
import {
  clearPausePoint,
  chooseTitle,
  createEntry,
  deriveStatus,
  filterAndSortEntries,
  formatTimestamp,
  hasPausePoint,
  progressPercent,
  setPausePoint,
  setWatchedEpisodes,
  updateEntryMetadata,
} from "../modules/model.js";
import { createStorageAdapter } from "../modules/storage.js";

export function createPopupApp({
  doc = document,
  browserApi = browser,
  fetchImpl = fetch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const storage = createStorageAdapter(browserApi);
  const elements = getElements(doc);
  const state = {
    entries: [],
    filter: "all",
    pendingRemovalId: null,
    pauseEditorId: null,
    searchResults: [],
    searchTimer: null,
    searchController: null,
    lastSearchTerm: "",
  };

  async function init() {
    bindEvents();
    try {
      const result = await storage.loadEntries();
      state.entries = result.entries;
      showSyncStatus(result.syncStatus);
    } catch (error) {
      showAppError(error.message || "Your anime list could not be loaded.");
    }
    renderList();
  }

  function bindEvents() {
    elements.openSearch.addEventListener("click", openSearch);
    elements.emptyAdd.addEventListener("click", openSearch);
    elements.closeSearch.addEventListener("click", closeSearch);
    elements.filters.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      state.pendingRemovalId = null;
      state.pauseEditorId = null;
      renderList();
    });
    elements.animeList.addEventListener("click", handleListClick);
    elements.animeList.addEventListener("change", handleProgressInput);
    elements.animeList.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-progress-id]")) {
        event.target.blur();
      } else if (event.key === "Enter" && event.target.matches("[data-pause-episode], [data-pause-time]")) {
        event.preventDefault();
        event.target.closest(".anime-card")?.querySelector('[data-action="save-pause"]')?.click();
      } else if (event.key === "Escape" && event.target.matches("[data-pause-episode], [data-pause-time]")) {
        event.preventDefault();
        event.target.closest(".anime-card")?.querySelector('[data-action="cancel-pause"]')?.click();
      }
    });
    elements.searchInput.addEventListener("input", queueSearch);
    elements.searchResults.addEventListener("click", handleSearchResultClick);
    elements.retrySearch.addEventListener("click", () => performSearch(state.lastSearchTerm));
  }

  function openSearch() {
    elements.trackerView.hidden = true;
    elements.searchView.hidden = false;
    elements.searchInput.focus();
  }

  function closeSearch() {
    cancelSearch();
    elements.searchView.hidden = true;
    elements.trackerView.hidden = false;
    elements.openSearch.focus();
  }

  function queueSearch() {
    cancelSearch();
    const term = elements.searchInput.value.trim();
    state.lastSearchTerm = term;
    state.searchResults = [];
    elements.retrySearch.hidden = true;

    if (term.length < 2) {
      elements.searchStatus.textContent = "Type at least 2 characters to search.";
      renderSearchResults();
      return;
    }

    elements.searchStatus.textContent = "Waiting to search…";
    state.searchTimer = setTimer(() => performSearch(term), 350);
  }

  async function performSearch(term) {
    cancelSearch();
    state.lastSearchTerm = term;
    state.searchController = new AbortController();
    elements.searchStatus.textContent = `Searching for “${term}”…`;
    elements.retrySearch.hidden = true;

    try {
      state.searchResults = await searchAnime(term, {
        fetchImpl,
        signal: state.searchController.signal,
      });
      elements.searchStatus.textContent = state.searchResults.length
        ? `${state.searchResults.length} result${state.searchResults.length === 1 ? "" : "s"}`
        : `No results found for “${term}”.`;
      renderSearchResults();
    } catch (error) {
      if (error.name === "AbortError") return;
      state.searchResults = [];
      renderSearchResults();
      elements.searchStatus.textContent = error.message || "Search failed. Please try again.";
      elements.retrySearch.hidden = false;
    } finally {
      state.searchController = null;
    }
  }

  function cancelSearch() {
    if (state.searchTimer !== null) {
      clearTimer(state.searchTimer);
      state.searchTimer = null;
    }
    state.searchController?.abort();
    state.searchController = null;
  }

  async function handleListClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const entry = state.entries.find((candidate) => candidate.anilistId === id);
    if (!entry) return;

    if (button.dataset.action === "remove") {
      state.pendingRemovalId = id;
      state.pauseEditorId = null;
      renderList();
      return;
    }
    if (button.dataset.action === "cancel-remove") {
      state.pendingRemovalId = null;
      renderList();
      return;
    }
    if (button.dataset.action === "confirm-remove") {
      state.entries = state.entries.filter((candidate) => candidate.anilistId !== id);
      state.pendingRemovalId = null;
      renderList();
      try {
        showSyncStatus(await storage.removeEntry(id));
      } catch (error) {
        showAppError(error.message || "The anime could not be removed.");
      }
      return;
    }
    if (button.dataset.action === "edit-pause") {
      state.pauseEditorId = id;
      state.pendingRemovalId = null;
      renderList();
      elements.animeList.querySelector(`[data-anime-id="${id}"] [data-pause-episode]`)?.focus();
      return;
    }
    if (button.dataset.action === "cancel-pause") {
      state.pauseEditorId = null;
      renderList();
      return;
    }
    if (button.dataset.action === "save-pause") {
      const card = button.closest(".anime-card");
      try {
        const updated = setPausePoint(
          entry,
          card.querySelector("[data-pause-episode]").value,
          card.querySelector("[data-pause-time]").value,
        );
        state.pauseEditorId = null;
        await saveEntry(updated, "The pause point could not be saved.");
      } catch (error) {
        const errorElement = card.querySelector(".pause-error");
        errorElement.textContent = error.message;
        errorElement.hidden = false;
      }
      return;
    }
    if (button.dataset.action === "clear-pause") {
      state.pauseEditorId = null;
      await saveEntry(clearPausePoint(entry), "The pause point could not be cleared.");
      return;
    }

    if (button.dataset.action === "increment" || button.dataset.action === "decrement") {
      const adjustment = button.dataset.action === "increment" ? 1 : -1;
      await saveProgress(entry, entry.watchedEpisodes + adjustment);
    }
  }

  async function handleProgressInput(event) {
    const input = event.target.closest("[data-progress-id]");
    if (!input) return;
    const entry = state.entries.find((candidate) => candidate.anilistId === Number(input.dataset.progressId));
    if (entry) {
      await saveProgress(entry, input.value);
    }
  }

  async function saveProgress(entry, requestedValue) {
    const updated = setWatchedEpisodes(entry, requestedValue);
    if (updated === entry) {
      renderList();
      return;
    }
    await saveEntry(updated, "Progress could not be saved.");
  }

  async function saveEntry(updated, errorMessage) {
    replaceEntry(updated);
    renderList();
    try {
      showSyncStatus(await storage.saveEntry(updated));
    } catch (error) {
      showAppError(error.message || errorMessage);
    }
  }

  async function handleSearchResultClick(event) {
    const button = event.target.closest("[data-result-id]");
    if (!button) return;
    const id = Number(button.dataset.resultId);
    const media = state.searchResults.find((candidate) => candidate.id === id);
    if (!media) return;

    button.disabled = true;
    button.textContent = "Saving…";
    const existing = state.entries.find((candidate) => candidate.anilistId === id);
    const entry = existing ? updateEntryMetadata(existing, media) : createEntry(media);
    replaceEntry(entry);
    renderList();

    try {
      showSyncStatus(await storage.saveEntry(entry));
      renderSearchResults();
    } catch (error) {
      showAppError(error.message || "The anime could not be saved.");
      button.disabled = false;
      button.textContent = existing ? "Update" : "Add";
    }
  }

  function replaceEntry(entry) {
    const index = state.entries.findIndex((candidate) => candidate.anilistId === entry.anilistId);
    if (index === -1) {
      state.entries.push(entry);
    } else {
      state.entries[index] = entry;
    }
  }

  function renderList() {
    const visible = filterAndSortEntries(state.entries, state.filter);
    elements.animeList.replaceChildren(...visible.map(renderAnimeCard));
    elements.animeList.hidden = visible.length === 0;
    elements.listEmpty.hidden = visible.length !== 0;

    const total = state.entries.length;
    elements.entrySummary.textContent = `${total} anime in your list`;
    for (const button of elements.filters.querySelectorAll("[data-filter]")) {
      button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter));
    }

    const emptyHeading = elements.listEmpty.querySelector("h2");
    const emptyCopy = elements.listEmpty.querySelector("p");
    const emptyButton = elements.listEmpty.querySelector("button");
    if (total && !visible.length) {
      emptyHeading.textContent = `No ${state.filter} anime`;
      emptyCopy.textContent = "Choose another filter or add a new anime.";
      emptyButton.textContent = "Add anime";
    } else {
      emptyHeading.textContent = "No anime here yet";
      emptyCopy.textContent = "Search AniList and add a show to start tracking your progress.";
      emptyButton.textContent = "Add your first anime";
    }
  }

  function renderAnimeCard(entry) {
    const card = createElement(doc, "article", "anime-card");
    card.dataset.animeId = String(entry.anilistId);
    card.append(renderCover(entry.coverUrl, entry.title));

    const content = createElement(doc, "div", "card-content");
    content.append(
      withText(createElement(doc, "div", "card-title"), entry.title),
      withText(createElement(doc, "div", "card-meta"), formatMetadata(entry)),
      withText(createElement(doc, "span", "status-badge"), deriveStatus(entry)),
    );

    const progressRow = createElement(doc, "div", "progress-row");
    const progress = createElement(doc, "progress");
    progress.max = 100;
    progress.value = progressPercent(entry);
    progress.setAttribute(
      "aria-label",
      `${entry.watchedEpisodes} of ${entry.totalEpisodes ?? "an unknown number of"} episodes watched`,
    );
    const count = withText(
      createElement(doc, "span", "progress-count"),
      `${entry.watchedEpisodes} / ${entry.totalEpisodes ?? "?"}`,
    );
    progressRow.append(progress, count);
    content.append(progressRow, renderPausePoint(entry), renderCardActions(entry));
    card.append(content);
    return card;
  }

  function renderCardActions(entry) {
    const actions = createElement(doc, "div", "card-actions");
    if (state.pendingRemovalId === entry.anilistId) {
      actions.append(
        withText(createElement(doc, "span", "confirm-copy"), "Remove this anime?"),
        actionButton("Cancel", "cancel-remove", entry.anilistId, "cancel-button"),
        actionButton("Remove", "confirm-remove", entry.anilistId, "confirm-button"),
      );
      return actions;
    }

    const decrease = actionButton("−", "decrement", entry.anilistId, "step-button");
    decrease.setAttribute("aria-label", `Decrease watched episodes for ${entry.title}`);
    decrease.disabled = entry.watchedEpisodes <= 0;

    const input = createElement(doc, "input", "episode-input");
    input.type = "number";
    input.min = "0";
    if (entry.totalEpisodes) input.max = String(entry.totalEpisodes);
    input.value = String(entry.watchedEpisodes);
    input.dataset.progressId = String(entry.anilistId);
    input.setAttribute("aria-label", `Watched episodes for ${entry.title}`);

    const increase = actionButton("+", "increment", entry.anilistId, "step-button");
    increase.setAttribute("aria-label", `Increase watched episodes for ${entry.title}`);
    increase.disabled = Boolean(entry.totalEpisodes && entry.watchedEpisodes >= entry.totalEpisodes);

    const remove = actionButton("×", "remove", entry.anilistId, "remove-button");
    remove.setAttribute("aria-label", `Remove ${entry.title}`);
    actions.append(decrease, input, increase, remove);
    return actions;
  }

  function renderPausePoint(entry) {
    const section = createElement(doc, "div", "pause-section");
    if (state.pauseEditorId !== entry.anilistId) {
      const summary = withText(
        createElement(doc, "span", hasPausePoint(entry) ? "pause-summary" : "pause-empty"),
        hasPausePoint(entry)
          ? `Paused at episode ${entry.pausedEpisode} · ${formatTimestamp(entry.pausedAtSeconds)}`
          : "No pause point saved",
      );
      const edit = actionButton(
        hasPausePoint(entry) ? "Edit" : "Set pause point",
        "edit-pause",
        entry.anilistId,
        "pause-edit-button",
      );
      edit.setAttribute("aria-label", `${hasPausePoint(entry) ? "Edit" : "Set"} pause point for ${entry.title}`);
      section.append(summary, edit);
      return section;
    }

    const fields = createElement(doc, "div", "pause-fields");
    const episodeLabel = withText(createElement(doc, "label", "pause-field"), "Episode");
    const episodeInput = createElement(doc, "input", "pause-episode-input");
    episodeInput.type = "number";
    episodeInput.min = "1";
    if (entry.totalEpisodes) episodeInput.max = String(entry.totalEpisodes);
    episodeInput.value = String(entry.pausedEpisode ?? defaultPausedEpisode(entry));
    episodeInput.dataset.pauseEpisode = String(entry.anilistId);
    episodeLabel.append(episodeInput);

    const timeLabel = withText(createElement(doc, "label", "pause-field"), "Timestamp");
    const timeInput = createElement(doc, "input", "pause-time-input");
    timeInput.type = "text";
    timeInput.inputMode = "numeric";
    timeInput.placeholder = "12:34";
    timeInput.value = hasPausePoint(entry) ? formatTimestamp(entry.pausedAtSeconds) : "0:00";
    timeInput.dataset.pauseTime = String(entry.anilistId);
    timeInput.setAttribute("aria-describedby", `pause-help-${entry.anilistId}`);
    timeLabel.append(timeInput);
    fields.append(episodeLabel, timeLabel);

    const help = withText(
      createElement(doc, "span", "pause-help"),
      "Use MM:SS or HH:MM:SS",
    );
    help.id = `pause-help-${entry.anilistId}`;
    const error = createElement(doc, "span", "pause-error");
    error.setAttribute("role", "alert");
    error.hidden = true;

    const editorActions = createElement(doc, "div", "pause-editor-actions");
    if (hasPausePoint(entry)) {
      editorActions.append(actionButton("Clear", "clear-pause", entry.anilistId, "pause-clear-button"));
    }
    editorActions.append(
      actionButton("Cancel", "cancel-pause", entry.anilistId, "cancel-button"),
      actionButton("Save", "save-pause", entry.anilistId, "pause-save-button"),
    );
    section.classList.add("pause-section-editing");
    section.append(fields, help, error, editorActions);
    return section;
  }

  function renderSearchResults() {
    elements.searchResults.replaceChildren(...state.searchResults.map((media) => {
      const card = createElement(doc, "article", "result-card");
      card.append(renderCover(media.coverUrl, chooseTitle(media.title)));

      const content = createElement(doc, "div", "result-content");
      content.append(
        withText(createElement(doc, "div", "result-title"), chooseTitle(media.title)),
        withText(createElement(doc, "div", "result-meta"), formatSearchMetadata(media)),
      );
      card.append(content);

      const exists = state.entries.some((entry) => entry.anilistId === media.id);
      const button = withText(
        createElement(doc, "button", "result-action"),
        exists ? "Update" : "Add",
      );
      button.type = "button";
      button.dataset.resultId = String(media.id);
      button.setAttribute("aria-label", `${exists ? "Update" : "Add"} ${chooseTitle(media.title)}`);
      card.append(button);
      return card;
    }));
  }

  function renderCover(url, title) {
    if (!url) {
      return withText(createElement(doc, "div", "cover-placeholder"), "▶");
    }
    const image = createElement(doc, "img", "cover");
    image.src = url;
    image.alt = `${title} cover`;
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.replaceWith(withText(createElement(doc, "div", "cover-placeholder"), "▶"));
    }, { once: true });
    return image;
  }

  function actionButton(label, action, id, className) {
    const button = withText(createElement(doc, "button", className), label);
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = String(id);
    return button;
  }

  function showSyncStatus(syncStatus) {
    elements.syncNotice.hidden = syncStatus !== "local-only";
  }

  function showAppError(message) {
    elements.appError.textContent = message;
    elements.appError.hidden = false;
  }

  return { init, state, performSearch, renderList };
}

function getElements(doc) {
  return {
    trackerView: doc.querySelector("#tracker-view"),
    searchView: doc.querySelector("#search-view"),
    openSearch: doc.querySelector("#open-search"),
    emptyAdd: doc.querySelector("#empty-add"),
    closeSearch: doc.querySelector("#close-search"),
    filters: doc.querySelector("#filters"),
    animeList: doc.querySelector("#anime-list"),
    listEmpty: doc.querySelector("#list-empty"),
    entrySummary: doc.querySelector("#entry-summary"),
    syncNotice: doc.querySelector("#sync-notice"),
    appError: doc.querySelector("#app-error"),
    searchInput: doc.querySelector("#search-input"),
    searchStatus: doc.querySelector("#search-status"),
    searchResults: doc.querySelector("#search-results"),
    retrySearch: doc.querySelector("#retry-search"),
  };
}

function createElement(doc, tagName, className = "") {
  const element = doc.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function withText(element, text) {
  element.textContent = text;
  return element;
}

function formatMetadata(entry) {
  return [formatLabel(entry.format), entry.seasonYear].filter(Boolean).join(" · ") || "Anime";
}

function formatSearchMetadata(media) {
  const episodes = media.episodes ? `${media.episodes} eps` : "Episodes TBD";
  return [formatLabel(media.format), media.seasonYear, episodes].filter(Boolean).join(" · ");
}

function defaultPausedEpisode(entry) {
  const nextEpisode = Math.max(1, entry.watchedEpisodes + 1);
  return entry.totalEpisodes ? Math.min(nextEpisode, entry.totalEpisodes) : nextEpisode;
}

function formatLabel(value) {
  return value ? value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "";
}

if (typeof document !== "undefined" && typeof browser !== "undefined") {
  createPopupApp().init();
}
