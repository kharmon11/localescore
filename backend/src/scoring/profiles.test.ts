import { test } from "node:test";
import assert from "node:assert/strict";

// See db.test.ts for why DATABASE_URL is stubbed before a dynamic import.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { pool } = await import("../db.ts");
const { loadScoringProfile, NotFoundError } = await import("./profiles.ts");

const STORED_WEIGHTS = {
  demandDensity: 0.25,
  competitiveSaturation: 0.2,
  complementaryDraw: 0.2,
  accessibilityVisibility: 0.2,
  growthTrend: 0.15,
};

const PROFILE_ROW = {
  subtype: "coffee_shop",
  version: 3,
  weights: STORED_WEIGHTS,
  normalization_params: {
    populationPercentiles: [1000, 2000, 3000],
    citywideMedianCompetitorsPer1000: 2,
    complementaryDrawPercentiles: [1, 2, 3],
    growthRatePercentiles: [-2, 0, 2],
  },
  isochrone_profile: { mode: "foot-walking", rangesMinutes: [5, 10], primaryRingWeight: 0.7, secondaryRingWeight: 0.3 },
};

function withMockQuery(rows: any[], fn: () => Promise<void>): Promise<void> {
  const originalQuery = pool.query;
  // A zero-arg mock overlaps too little with pool.query's real overloaded
  // signature for a direct cast (TypeScript flags it as "may be a
  // mistake"); routing through `unknown` first is what it suggests for a
  // mock this much narrower than the real type, same underlying pattern as
  // every other pool.query mock in this codebase.
  pool.query = (async () => ({ rows })) as unknown as typeof pool.query;
  return fn().finally(() => {
    pool.query = originalQuery;
  });
}

test("loadScoringProfile returns the stored weights unchanged when no override is given", async () => {
  await withMockQuery([PROFILE_ROW], async () => {
    const profile = await loadScoringProfile("coffee_shop");
    assert.deepEqual(profile.weights, STORED_WEIGHTS);
    assert.equal(profile.isOverridden, false);
    assert.equal(profile.version, 3);
  });
});

test("loadScoringProfile merges a partial weights override on top of the stored weights", async () => {
  await withMockQuery([PROFILE_ROW], async () => {
    const profile = await loadScoringProfile("coffee_shop", { demandDensity: 0.5 });
    // The overridden key changes...
    assert.equal(profile.weights.demandDensity, 0.5);
    // ...every other key keeps its stored value, not just the overridden one.
    assert.equal(profile.weights.competitiveSaturation, STORED_WEIGHTS.competitiveSaturation);
    assert.equal(profile.weights.complementaryDraw, STORED_WEIGHTS.complementaryDraw);
    assert.equal(profile.weights.accessibilityVisibility, STORED_WEIGHTS.accessibilityVisibility);
    assert.equal(profile.weights.growthTrend, STORED_WEIGHTS.growthTrend);
    assert.equal(profile.isOverridden, true);
  });
});

test("loadScoringProfile merges a full weights override, replacing every stored weight", async () => {
  await withMockQuery([PROFILE_ROW], async () => {
    const fullOverride = {
      demandDensity: 0.6,
      competitiveSaturation: 0.1,
      complementaryDraw: 0.1,
      accessibilityVisibility: 0.1,
      growthTrend: 0.1,
    };
    const profile = await loadScoringProfile("coffee_shop", fullOverride);
    assert.deepEqual(profile.weights, fullOverride);
    assert.equal(profile.isOverridden, true);
  });
});

test("loadScoringProfile throws NotFoundError when no active profile exists for the subtype", async () => {
  await withMockQuery([], async () => {
    await assert.rejects(
      () => loadScoringProfile("coffee_shop"),
      (err: unknown) => {
        assert.ok(err instanceof NotFoundError);
        assert.match(err.message, /No active scoring profile/);
        return true;
      }
    );
  });
});
