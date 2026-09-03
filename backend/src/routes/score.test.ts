import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";

// See db.test.ts for why DATABASE_URL is stubbed before a dynamic import.
// ORS_API_KEY is stubbed too, since getIsochrone's fetch path checks for it.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ORS_API_KEY ??= "test-key";
const { pool } = await import("../db.ts");
const { scoreRouter, validateRequest, growthTrendNote, formatAcsVintageRange } =
  await import("./score.ts");

const VALID_PROFILE_ROW = {
  subtype: "coffee_shop",
  version: 1,
  weights: {
    demandDensity: 0.25,
    competitiveSaturation: 0.2,
    complementaryDraw: 0.2,
    accessibilityVisibility: 0.2,
    growthTrend: 0.15,
  },
  normalization_params: {
    populationPercentiles: [1000, 2000, 3000, 4000, 5000],
    citywideMedianCompetitorsPer1000: 2,
    complementaryDrawPercentiles: [1, 2, 3, 4, 5],
    growthRatePercentiles: [-2, 0, 2, 4, 6],
  },
  isochrone_profile: { mode: "foot-walking", rangesMinutes: [5, 10], primaryRingWeight: 0.7, secondaryRingWeight: 0.3 },
};

const FIXTURE_ISOCHRONE = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { value: 300 }, geometry: { type: "Polygon", coordinates: [] } },
    { type: "Feature", properties: { value: 600 }, geometry: { type: "Polygon", coordinates: [] } },
  ],
};

// Routes a mocked pool.query call to a fixture based on the SQL text, since
// one /score request fans out to several distinct queries. Covers every
// query shape the happy path touches; tests that want one of them to fail
// wrap this and override just that branch.
function happyPathQueryMock(text: string): { rows: any[] } {
  if (text.includes("FROM scoring_profiles")) return { rows: [VALID_PROFILE_ROW] };
  if (text.includes("FROM isochrone_cache")) return { rows: [] };
  if (text.includes("INSERT INTO isochrone_cache")) return { rows: [] };
  if (text.includes("FROM census_block_groups")) {
    return {
      rows: [
        {
          primary_population: "1500",
          secondary_population: "800",
          primary_population_prior: "1400",
          secondary_population_prior: "750",
          current_acs_vintage: "2024-5yr",
          prior_acs_vintage: "2019-5yr",
        },
      ],
    };
  }
  if (text.includes("AS competitor_count")) return { rows: [{ competitor_count: "3" }] };
  if (text.includes("SELECT category_primary")) {
    return { rows: [{ category_primary: "cafe" }, { category_primary: "grocery_store" }] };
  }
  if (text.includes("FROM road_segments")) return { rows: [{ road_class: "secondary" }] };
  if (text.includes("COUNT(*) AS n")) return { rows: [{ n: "1" }] };
  throw new Error(`Unhandled query in test mock: ${text}`);
}

// A deliberately minimal stand-in for the real fetch Response; see the same
// interface in isochrone.test.ts for why this isn't just Response.
interface MockOrsResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function orsResponse(status: number, body: string, headers: Record<string, string> = {}): MockOrsResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function startServer(): Promise<Server> {
  const app = express();
  app.use(express.json());
  app.use(scoreRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

type QueryImpl = (text: string, params?: any[]) => { rows: any[] };
type FetchImpl = (url: string, options: RequestInit) => Promise<MockOrsResponse | never>;

// pool.query and fetch are both mocked for the duration of `fn`, so `fn`
// receives the real, unmocked fetch to make its own request into the test
// server with. Using the (mocked) global fetch for that would recurse into
// the ORS mock instead of hitting the server.
async function withTestServer(
  { queryImpl, fetchImpl }: { queryImpl?: QueryImpl; fetchImpl?: FetchImpl } = {},
  fn: (port: number, realFetch: typeof fetch) => Promise<void>
): Promise<void> {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  pool.query = (queryImpl
    ? async (text: string, params?: any[]) => queryImpl(text, params)
    : async (text: string) => {
        throw new Error(`Unexpected query in test: ${text}`);
      }) as typeof pool.query;
  globalThis.fetch = (fetchImpl ??
    (async () => {
      throw new Error("Unexpected fetch (ORS call) in test");
    })) as typeof fetch;

  const server = await startServer();
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await fn(port, originalFetch);
  } finally {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postScore(realFetch: typeof fetch, port: number, body: unknown): Promise<{ status: number; body: any }> {
  const res = await realFetch(`http://127.0.0.1:${port}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// validateRequest

test("validateRequest accepts a valid request", () => {
  assert.equal(validateRequest({ lat: 41.25, lng: -95.93, subtype: "coffee_shop" }), null);
});

test("validateRequest accepts lat/lng at the exact boundary values", () => {
  assert.equal(validateRequest({ lat: -90, lng: -180, subtype: "coffee_shop" }), null);
  assert.equal(validateRequest({ lat: 90, lng: 180, subtype: "coffee_shop" }), null);
});

test("validateRequest rejects an out-of-range or non-numeric lat", () => {
  assert.match(validateRequest({ lat: 91, lng: 0, subtype: "coffee_shop" }) ?? "", /lat must be a number/);
  assert.match(validateRequest({ lat: -91, lng: 0, subtype: "coffee_shop" }) ?? "", /lat must be a number/);
  assert.match(validateRequest({ lat: "41.25", lng: 0, subtype: "coffee_shop" }) ?? "", /lat must be a number/);
  assert.match(validateRequest({ lat: undefined, lng: 0, subtype: "coffee_shop" }) ?? "", /lat must be a number/);
});

test("validateRequest rejects an out-of-range or non-numeric lng", () => {
  assert.match(validateRequest({ lat: 0, lng: 181, subtype: "coffee_shop" }) ?? "", /lng must be a number/);
  assert.match(validateRequest({ lat: 0, lng: -181, subtype: "coffee_shop" }) ?? "", /lng must be a number/);
  assert.match(validateRequest({ lat: 0, lng: "0", subtype: "coffee_shop" }) ?? "", /lng must be a number/);
});

test("validateRequest rejects an unknown subtype", () => {
  const error = validateRequest({ lat: 0, lng: 0, subtype: "food_truck" }) ?? "";
  assert.match(error, /subtype must be one of/);
  assert.match(error, /coffee_shop/);
});

test("validateRequest rejects a non-string subtype", () => {
  // subtype arrives as unknown from an unvalidated request body; the
  // typeof guard added during the TypeScript conversion (required so
  // Object.keys(...).includes(subtype) type-checks) needs to actually
  // reject a non-string value at runtime, not just satisfy the compiler.
  assert.match(validateRequest({ lat: 0, lng: 0, subtype: 42 }) ?? "", /subtype must be one of/);
  assert.match(validateRequest({ lat: 0, lng: 0, subtype: { coffee_shop: true } }) ?? "", /subtype must be one of/);
  assert.match(validateRequest({ lat: 0, lng: 0, subtype: null }) ?? "", /subtype must be one of/);
  assert.match(validateRequest({ lat: 0, lng: 0, subtype: undefined }) ?? "", /subtype must be one of/);
});

// formatAcsVintageRange

test("formatAcsVintageRange formats a well-formed vintage label", () => {
  assert.equal(formatAcsVintageRange("2024-5yr"), "2020–2024");
});

test("formatAcsVintageRange returns null for malformed or missing input", () => {
  assert.equal(formatAcsVintageRange("2024"), null);
  assert.equal(formatAcsVintageRange("not-a-vintage"), null);
  assert.equal(formatAcsVintageRange(null), null);
  assert.equal(formatAcsVintageRange(undefined), null);
  assert.equal(formatAcsVintageRange(""), null);
});

// growthTrendNote

test("growthTrendNote formats both vintages when present", () => {
  const note = growthTrendNote("2024-5yr", "2019-5yr");
  assert.match(note, /2015–2019/);
  assert.match(note, /2020–2024/);
  assert.match(note, /^Approximate:/);
});

test("growthTrendNote falls back to a generic message when a vintage is missing", () => {
  assert.match(growthTrendNote(null, "2019-5yr"), /vintage data unavailable/);
  assert.match(growthTrendNote("2024-5yr", null), /vintage data unavailable/);
  assert.match(growthTrendNote(null, null), /vintage data unavailable/);
});

// POST /score

test("POST /score returns 400 for an invalid request with no downstream calls", async () => {
  await withTestServer({}, async (port, realFetch) => {
    const { status, body } = await postScore(realFetch, port, {
      lat: 999,
      lng: -95,
      subtype: "coffee_shop",
    });
    assert.equal(status, 400);
    assert.match(body.error, /lat must be a number/);
  });
});

test("POST /score returns 404 when no active scoring profile exists for the subtype", async () => {
  await withTestServer(
    { queryImpl: (text) => (text.includes("FROM scoring_profiles") ? { rows: [] } : happyPathQueryMock(text)) },
    async (port, realFetch) => {
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
      });
      assert.equal(status, 404);
      assert.match(body.error, /No active scoring profile/);
    }
  );
});

test("POST /score returns 503 with type quota_exceeded and resetAt when the ORS quota is exhausted", async () => {
  const resetEpochSeconds = 1893456000;
  await withTestServer(
    {
      queryImpl: happyPathQueryMock,
      fetchImpl: async () =>
        orsResponse(403, '{"error":"Quota exceeded"}', {
          "x-ratelimit-reset": String(resetEpochSeconds),
        }),
    },
    async (port, realFetch) => {
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
      });
      assert.equal(status, 503);
      assert.equal(body.type, "quota_exceeded");
      assert.equal(body.resetAt, new Date(resetEpochSeconds * 1000).toISOString());
    }
  );
});

test("POST /score returns 502 with type transient when ORS fails and the retry also fails", async () => {
  await withTestServer(
    {
      queryImpl: happyPathQueryMock,
      fetchImpl: async () => orsResponse(502, "Bad Gateway"),
    },
    async (port, realFetch) => {
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
      });
      assert.equal(status, 502);
      assert.equal(body.type, "transient");
    }
  );
});

test("POST /score returns 200 with a fully shaped result on the happy path", async () => {
  await withTestServer(
    {
      queryImpl: happyPathQueryMock,
      fetchImpl: async () => orsResponse(200, JSON.stringify(FIXTURE_ISOCHRONE)),
    },
    async (port, realFetch) => {
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
      });
      assert.equal(status, 200);
      assert.equal(body.subtype, "coffee_shop");
      assert.equal(body.profileVersion, 1);
      assert.equal(body.weightsOverridden, false);
      assert.ok(typeof body.overall === "number" && body.overall >= 0 && body.overall <= 100);
      assert.ok(["strong", "good", "marginal", "weak"].includes(body.band));
      assert.ok("demandDensity" in body.subscores);
      assert.deepEqual(body.isochrone, FIXTURE_ISOCHRONE);
      assert.match(body.notes.growthTrend, /^Approximate:/);
    }
  );
});

test("POST /score applies a weights override end to end, not just flagging weightsOverridden", async () => {
  await withTestServer(
    {
      queryImpl: happyPathQueryMock,
      fetchImpl: async () => orsResponse(200, JSON.stringify(FIXTURE_ISOCHRONE)),
    },
    async (port, realFetch) => {
      // Weighting demandDensity at 100% and everything else at 0% makes the
      // override's effect exactly verifiable: overall must equal the
      // demandDensity subscore alone, not some blend that could pass even if
      // the override silently failed to apply.
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
        weights: {
          demandDensity: 1,
          competitiveSaturation: 0,
          complementaryDraw: 0,
          accessibilityVisibility: 0,
          growthTrend: 0,
        },
      });
      assert.equal(status, 200);
      assert.equal(body.weightsOverridden, true);
      // happyPathQueryMock's census_block_groups fixture (primary_population
      // 1500, secondary_population 800) with the seeded 0.7/0.3 ring weights
      // gives population 1290, which falls at the 20th percentile of
      // VALID_PROFILE_ROW's populationPercentiles benchmark.
      assert.equal(body.subscores.demandDensity, 20);
      assert.equal(body.overall, 20);
    }
  );
});

test("POST /score returns a generic 500 for an unexpected internal error, without leaking details", async () => {
  await withTestServer(
    {
      queryImpl: (text) => {
        if (text.includes("FROM census_block_groups")) {
          throw new Error('relation "census_block_groups" does not exist');
        }
        return happyPathQueryMock(text);
      },
      fetchImpl: async () => orsResponse(200, JSON.stringify(FIXTURE_ISOCHRONE)),
    },
    async (port, realFetch) => {
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
      });
      assert.equal(status, 500);
      assert.equal(body.error, "Failed to compute score. See server logs for details.");
      assert.equal(body.type, undefined, "the generic fallback should not include a type field");
    }
  );
});

test("POST /score cancels the ORS call and skips the retry when the client disconnects", async () => {
  let fetchCalls = 0;
  await withTestServer(
    {
      queryImpl: happyPathQueryMock,
      // Never resolves on its own; only settles if its signal is aborted,
      // same as a real fetch() would when the client disconnects.
      fetchImpl: (url, options) =>
        new Promise((resolve, reject) => {
          fetchCalls++;
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    },
    async (port, realFetch) => {
      const controller = new AbortController();
      const requestPromise = realFetch(`http://127.0.0.1:${port}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: 41.25, lng: -95.93, subtype: "coffee_shop" }),
        signal: controller.signal,
      });

      // Give the server time to reach the ORS fetch call before disconnecting.
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort();
      await assert.rejects(() => requestPromise, { name: "AbortError" });

      // Give the server's res.on("close") handler time to fire.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(fetchCalls, 1, "a disconnected client should not trigger a retry");
    }
  );
});
