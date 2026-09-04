import assert from "node:assert/strict";
import test from "node:test";

import { AniListError, searchAnime } from "../extension/modules/anilist.js";

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("searches anime and normalizes the returned fields", async () => {
  let request;
  const results = await searchAnime(" Bebop ", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
        data: {
          Page: {
            media: [{
              id: 1,
              title: { english: "Cowboy Bebop", romaji: "Cowboy Bebop", native: "カウボーイビバップ" },
              coverImage: { large: "large.jpg", medium: "medium.jpg" },
              episodes: 26,
              format: "TV",
              seasonYear: 1998,
              status: "FINISHED",
            }],
          },
        },
      });
    },
  });

  assert.equal(request.url, "https://graphql.anilist.co");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).variables.search, "Bebop");
  assert.deepEqual(results[0], {
    id: 1,
    title: { english: "Cowboy Bebop", romaji: "Cowboy Bebop", native: "カウボーイビバップ" },
    coverUrl: "large.jpg",
    episodes: 26,
    format: "TV",
    seasonYear: 1998,
    status: "FINISHED",
  });
});

test("does not issue a request for fewer than two characters", async () => {
  let calls = 0;
  const results = await searchAnime("a", { fetchImpl: async () => { calls += 1; } });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test("reports GraphQL errors even when HTTP succeeds", async () => {
  await assert.rejects(
    searchAnime("Bebop", {
      fetchImpl: async () => response({ errors: [{ message: "Query unavailable" }] }),
    }),
    (error) => error instanceof AniListError && error.code === "API" && error.message === "Query unavailable",
  );
});

test("reports rate limits with Retry-After guidance", async () => {
  await assert.rejects(
    searchAnime("Bebop", {
      fetchImpl: async () => response({ errors: [] }, { status: 429, headers: { "Retry-After": "30" } }),
    }),
    (error) => error.code === "RATE_LIMIT" && error.retryAfter === 30 && error.message.includes("30 seconds"),
  );
});

test("converts fetch failures to a readable network error", async () => {
  await assert.rejects(
    searchAnime("Bebop", { fetchImpl: async () => { throw new TypeError("offline"); } }),
    (error) => error.code === "NETWORK" && error.message.includes("Could not reach AniList"),
  );
});

