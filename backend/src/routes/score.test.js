import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// See db.test.js for why DATABASE_URL is stubbed before a dynamic import.
// ORS_API_KEY is stubbed too, since getIsochrone's fetch path checks for it.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ORS_API_KEY ??= "test-key";
const { pool } = await import("../db.js");
const { scoreRouter, validateRequest, growthTrendNote, formatAcsVintageRange } =
  await import("./score.js");

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
  isochrone_profile: { mode: "foot-walking", rangesMinutes: [5, 10] },
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
function happyPathQueryMock(text) {
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

function orsResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function startServer() {
  const app = express();
  app.use(express.json());
  app.use(scoreRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// pool.query and fetch are both mocked for the duration of `fn`, so `fn`
// receives the real, unmocked fetch to make its own request into the test
// server with -- using the (mocked) global fetch for that would recurse into
// the ORS mock instead of hitting the server.
async function withTestServer({ queryImpl, fetchImpl } = {}, fn) {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  pool.query = queryImpl
    ? async (text, params) => queryImpl(text, params)
    : async (text) => {
        throw new Error(`Unexpected query in test: ${text}`);
      };
  globalThis.fetch = fetchImpl ?? (async () => {
    throw new Error("Unexpected fetch (ORS call) in test");
  });

  const server = await startServer();
  try {
    await fn(server.address().port, originalFetch);
  } finally {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postScore(realFetch, port, body) {
  const res = await realFetch(`http://127.0.0.1:${port}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// -- validateRequest --------------------------------------------------------

test("validateRequest accepts a valid request", () => {
  assert.equal(validateRequest({ lat: 41.25, lng: -95.93, subtype: "coffee_shop" }), null);
});

test("validateRequest accepts lat/lng at the exact boundary values", () => {
  assert.equal(validateRequest({ lat: -90, lng: -180, subtype: "coffee_shop" }), null);
  assert.equal(validateRequest({ lat: 90, lng: 180, subtype: "coffee_shop" }), null);
});

test("validateRequest rejects an out-of-range or non-numeric lat", () => {
  assert.match(validateRequest({ lat: 91, lng: 0, subtype: "coffee_shop" }), /lat must be a number/);
  assert.match(validateRequest({ lat: -91, lng: 0, subtype: "coffee_shop" }), /lat must be a number/);
  assert.match(validateRequest({ lat: "41.25", lng: 0, subtype: "coffee_shop" }), /lat must be a number/);
  assert.match(validateRequest({ lat: undefined, lng: 0, subtype: "coffee_shop" }), /lat must be a number/);
});

test("validateRequest rejects an out-of-range or non-numeric lng", () => {
  assert.match(validateRequest({ lat: 0, lng: 181, subtype: "coffee_shop" }), /lng must be a number/);
  assert.match(validateRequest({ lat: 0, lng: -181, subtype: "coffee_shop" }), /lng must be a number/);
  assert.match(validateRequest({ lat: 0, lng: "0", subtype: "coffee_shop" }), /lng must be a number/);
});

test("validateRequest rejects an unknown subtype", () => {
  const error = validateRequest({ lat: 0, lng: 0, subtype: "food_truck" });
  assert.match(error, /subtype must be one of/);
  assert.match(error, /coffee_shop/);
});

// -- formatAcsVintageRange ---------------------------------------------------

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

// -- growthTrendNote ----------------------------------------------------------

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

// -- POST /score --------------------------------------------------------------

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

test("POST /score returns 503 with kind quota_exceeded when the ORS quota is exhausted", async () => {
  await withTestServer(
    {
      queryImpl: happyPathQueryMock,
      fetchImpl: async () => orsResponse(403, '{"error":"Quota exceeded"}'),
    },
    async (port, realFetch) => {
      const { status, body } = await postScore(realFetch, port, {
        lat: 41.25,
        lng: -95.93,
        subtype: "coffee_shop",
      });
      assert.equal(status, 503);
      assert.equal(body.kind, "quota_exceeded");
    }
  );
});

test("POST /score returns 502 with kind transient when ORS fails and the retry also fails", async () => {
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
      assert.equal(body.kind, "transient");
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
      assert.equal(body.kind, undefined, "the generic fallback should not include a kind field");
    }
  );
});
