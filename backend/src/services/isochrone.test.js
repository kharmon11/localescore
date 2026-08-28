import { test } from "node:test";
import assert from "node:assert/strict";

// See db.test.js for why DATABASE_URL is stubbed before a dynamic import --
// getIsochrone caches through db.js's pool, but never actually connects
// (pool.query is mocked in every test below). ORS_API_KEY is stubbed too,
// since fetchFromOpenRouteService checks for it before ever calling fetch().
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ORS_API_KEY ??= "test-key";
const { pool } = await import("../db.js");
const { getIsochrone, buildCacheKey, OrsQuotaExceededError, OrsTransientError } =
  await import("./isochrone.js");

const ISOCHRONE_PROFILE = { mode: "foot-walking", rangesMinutes: [5, 10] };
const FIXTURE_GEOJSON = { type: "FeatureCollection", features: [] };

function withMocks({ queryImpl, fetchImpl }, fn) {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  pool.query = queryImpl;
  globalThis.fetch = fetchImpl;
  return fn().finally(() => {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
  });
}

function orsResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

test("buildCacheKey rounds to 4 decimal places and varies by profile", () => {
  const a = buildCacheKey(41.256789, -95.934512, ISOCHRONE_PROFILE);
  assert.equal(a, "41.2568,-95.9345,foot-walking,5-10");

  const b = buildCacheKey(41.25684999, -95.93451, ISOCHRONE_PROFILE);
  assert.equal(b, "41.2568,-95.9345,foot-walking,5-10");
  assert.equal(a, b, "points within ~11m of each other share a cache key");

  const differentMode = buildCacheKey(41.256789, -95.934512, {
    mode: "driving-car",
    rangesMinutes: [5, 10],
  });
  assert.notEqual(a, differentMode);
});

test("OrsQuotaExceededError carries the status and a descriptive message", () => {
  const err = new OrsQuotaExceededError(403, '{"error":"Quota exceeded"}');
  assert.equal(err.name, "OrsQuotaExceededError");
  assert.equal(err.status, 403);
  assert.match(err.message, /403/);
  assert.match(err.message, /Quota exceeded/);
});

test("OrsTransientError preserves a given cause", () => {
  const cause = new TypeError("fetch failed");
  const err = new OrsTransientError("network blip", { cause });
  assert.equal(err.name, "OrsTransientError");
  assert.equal(err.cause, cause);
});

test("getIsochrone returns the cached GeoJSON on a cache hit without calling fetch", async () => {
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async () => ({ rows: [{ geojson: FIXTURE_GEOJSON }] }),
      fetchImpl: async () => {
        fetchCalls++;
        throw new Error("fetch should not be called on a cache hit");
      },
    },
    async () => {
      const result = await getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE);
      assert.equal(result, FIXTURE_GEOJSON);
      assert.equal(fetchCalls, 0);
    }
  );
});

test("getIsochrone fetches and caches on a cache miss", async () => {
  const queryCalls = [];
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async (text, params) => {
        queryCalls.push({ text, params });
        return { rows: [] }; // both the SELECT and the INSERT resolve empty
      },
      fetchImpl: async () => {
        fetchCalls++;
        return orsResponse(200, JSON.stringify(FIXTURE_GEOJSON));
      },
    },
    async () => {
      const result = await getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE);
      assert.deepEqual(result, FIXTURE_GEOJSON);
      assert.equal(fetchCalls, 1);
      assert.equal(queryCalls.length, 2, "one SELECT, one INSERT");
      assert.match(queryCalls[1].text, /INSERT INTO isochrone_cache/);
    }
  );
});

test("getIsochrone throws OrsQuotaExceededError on a 403 with no retry", async () => {
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async () => ({ rows: [] }),
      fetchImpl: async () => {
        fetchCalls++;
        return orsResponse(403, '{"error":"Quota exceeded"}');
      },
    },
    async () => {
      await assert.rejects(
        () => getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE),
        OrsQuotaExceededError
      );
      assert.equal(fetchCalls, 1, "quota errors are not retried");
    }
  );
});

test("getIsochrone retries once on a 502 and succeeds if the retry works", async () => {
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async () => ({ rows: [] }),
      fetchImpl: async () => {
        fetchCalls++;
        if (fetchCalls === 1) return orsResponse(502, "Bad Gateway");
        return orsResponse(200, JSON.stringify(FIXTURE_GEOJSON));
      },
    },
    async () => {
      const result = await getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE);
      assert.deepEqual(result, FIXTURE_GEOJSON);
      assert.equal(fetchCalls, 2);
    }
  );
});

test("getIsochrone throws OrsTransientError when a 502 persists through the retry", async () => {
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async () => ({ rows: [] }),
      fetchImpl: async () => {
        fetchCalls++;
        return orsResponse(502, "Bad Gateway");
      },
    },
    async () => {
      await assert.rejects(
        () => getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE),
        OrsTransientError
      );
      assert.equal(fetchCalls, 2, "exactly one retry");
    }
  );
});

test("getIsochrone classifies a pre-response fetch() rejection as transient and retries", async () => {
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async () => ({ rows: [] }),
      fetchImpl: async () => {
        fetchCalls++;
        if (fetchCalls === 1) throw new TypeError("fetch failed");
        return orsResponse(200, JSON.stringify(FIXTURE_GEOJSON));
      },
    },
    async () => {
      const result = await getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE);
      assert.deepEqual(result, FIXTURE_GEOJSON);
      assert.equal(fetchCalls, 2);
    }
  );
});

test("getIsochrone classifies an aborted/timed-out request as transient", async () => {
  let fetchCalls = 0;
  await withMocks(
    {
      queryImpl: async () => ({ rows: [] }),
      fetchImpl: async () => {
        fetchCalls++;
        const err = new DOMException("The operation was aborted.", "TimeoutError");
        throw err;
      },
    },
    async () => {
      await assert.rejects(
        () => getIsochrone(41.2565, -95.9345, ISOCHRONE_PROFILE),
        OrsTransientError
      );
      assert.equal(fetchCalls, 2, "exactly one retry, then give up");
    }
  );
});
