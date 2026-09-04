export const ANILIST_ENDPOINT = "https://graphql.anilist.co";

const SEARCH_QUERY = `
  query SearchAnime($search: String!) {
    Page(page: 1, perPage: 8) {
      media(
        search: $search
        type: ANIME
        isAdult: false
        sort: SEARCH_MATCH
      ) {
        id
        title {
          english
          romaji
          native
        }
        coverImage {
          large
          medium
        }
        episodes
        format
        seasonYear
        status
      }
    }
  }
`;

export class AniListError extends Error {
  constructor(code, message, retryAfter = null) {
    super(message);
    this.name = "AniListError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function searchAnime(search, { fetchImpl = fetch, signal } = {}) {
  const term = search.trim();
  if (term.length < 2) {
    return [];
  }

  let response;
  try {
    response = await fetchImpl(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: term } }),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    throw new AniListError("NETWORK", "Could not reach AniList. Check your connection and try again.");
  }

  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get("Retry-After"), 10) || null;
    throw new AniListError(
      "RATE_LIMIT",
      retryAfter
        ? `AniList is receiving too many requests. Try again in ${retryAfter} seconds.`
        : "AniList is receiving too many requests. Try again shortly.",
      retryAfter,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AniListError("INVALID_RESPONSE", "AniList returned an unreadable response.");
  }

  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.[0]?.message || `AniList request failed (${response.status}).`;
    throw new AniListError("API", message);
  }

  return (payload.data?.Page?.media || []).map(normalizeMedia);
}

export function normalizeMedia(media) {
  return {
    id: Number(media.id),
    title: {
      english: media.title?.english || null,
      romaji: media.title?.romaji || null,
      native: media.title?.native || null,
    },
    coverUrl: media.coverImage?.large || media.coverImage?.medium || "",
    episodes: Number.isInteger(media.episodes) && media.episodes > 0 ? media.episodes : null,
    format: media.format || null,
    seasonYear: Number.isInteger(media.seasonYear) ? media.seasonYear : null,
    status: media.status || null,
  };
}

