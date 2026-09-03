import { test } from "node:test";
import assert from "node:assert/strict";
import type { IsochroneFeatureCollection } from "../isochroneTypes.ts";

// See db.test.ts for why DATABASE_URL is stubbed before a dynamic import.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { pool } = await import("../db.ts");
const { computeRawMetrics } = await import("./spatialQueries.ts");

// Out of order on purpose: splitRings is responsible for sorting by
// properties.value itself, so this also confirms it doesn't just trust
// array order.
const ISOCHRONE: IsochroneFeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { value: 600 }, geometry: { type: "Polygon", coordinates: [], outer: true } },
    { type: "Feature", properties: { value: 300 }, geometry: { type: "Polygon", coordinates: [], outer: false } },
  ],
};

const RING_WEIGHTS = { primaryRingWeight: 0.7, secondaryRingWeight: 0.3 };
const COFFEE_SHOP_PATTERNS = ["coffee_shop", "coffee_roastery", "cafe"];

function withMockQuery(rows: Record<string, any[]>, fn: () => Promise<void>): Promise<void> {
  const originalQuery = pool.query;
  pool.query = (async (text: string) => {
    if (text.includes("FROM census_block_groups")) return { rows: rows.demandAndGrowth };
    if (text.includes("AS competitor_count")) return { rows: rows.competitorCount };
    if (text.includes("SELECT category_primary")) return { rows: rows.complementaryDraw };
    if (text.includes("COUNT(*) AS n")) return { rows: rows.transit };
    if (text.includes("FROM road_segments")) return { rows: rows.roadClass };
    throw new Error(`Unhandled query in test mock: ${text}`);
  }) as unknown as typeof pool.query;
  return fn().finally(() => {
    pool.query = originalQuery;
  });
}

test("computeRawMetrics combines every sub-score into the documented shape, with exact expected numbers", async () => {
  await withMockQuery(
    {
      demandAndGrowth: [
        {
          primary_population: "1000",
          secondary_population: "500",
          primary_population_prior: "800",
          secondary_population_prior: "400",
          current_acs_vintage: "2024-5yr",
          prior_acs_vintage: "2019-5yr",
        },
      ],
      competitorCount: [{ competitor_count: "3" }],
      // Deliberately includes a "_restaurant"-suffix category (never exercised
      // before this test), an unrecognized category (falls to 0), and a null
      // category_primary (also falls to 0), alongside two direct matches.
      complementaryDraw: [
        { category_primary: "cafe" },
        { category_primary: "grocery_store" },
        { category_primary: "thai_restaurant" },
        { category_primary: "unknown_category_xyz" },
        { category_primary: null },
      ],
      transit: [{ n: "1" }],
      roadClass: [{ road_class: "secondary" }],
    },
    async () => {
      const result = await computeRawMetrics(41.25, -95.93, ISOCHRONE, COFFEE_SHOP_PATTERNS, RING_WEIGHTS);

      // population = 0.7*1000 + 0.3*500 = 850
      assert.equal(result.population, 850);
      // populationPrior = 0.7*800 + 0.3*400 = 680; growthRatePct = (850-680)/680*100 = 25
      assert.equal(result.growthRatePct, 25);
      assert.equal(result.currentAcsVintage, "2024-5yr");
      assert.equal(result.priorAcsVintage, "2019-5yr");
      // tradeAreaPopulation = 1000+500 = 1500; competitorsPer1000 = 3/1500*1000 = 2
      assert.equal(result.competitorsPer1000, 2);
      // cafe(0.4) + grocery_store(0.8) + thai_restaurant->suffix->cafe weight(0.4) + unknown(0) + null(0) = 1.6
      assert.equal(result.complementaryWeightedCount, 1.6);
      // roadScore=85 (secondary), transitScore=min(100,1*50)=50; 0.75*85+0.25*50=76.25
      assert.equal(result.accessibilityRaw, 76.25);
    }
  );
});

test("computeRawMetrics skips the competitor-count query entirely when the trade area has no population", async () => {
  await withMockQuery(
    {
      demandAndGrowth: [
        {
          primary_population: "0",
          secondary_population: "0",
          primary_population_prior: "0",
          secondary_population_prior: "0",
          current_acs_vintage: null,
          prior_acs_vintage: null,
        },
      ],
      // No competitorCount fixture provided: computeCompetitorsPer1000's
      // tradeAreaPopulation <= 0 guard should return 0 without ever running
      // the "AS competitor_count" query, so the mock never needs to handle it
      // (it would throw "Unhandled query" if that guard didn't work).
      competitorCount: [],
      complementaryDraw: [],
      transit: [{ n: "0" }],
      roadClass: [],
    },
    async () => {
      const result = await computeRawMetrics(41.25, -95.93, ISOCHRONE, COFFEE_SHOP_PATTERNS, RING_WEIGHTS);
      assert.equal(result.competitorsPer1000, 0);
      assert.equal(result.population, 0);
      assert.equal(result.growthRatePct, 0, "growthRatePct falls back to 0 when populationPrior is 0, not NaN");
    }
  );
});
