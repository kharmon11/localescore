import { test } from "node:test";
import assert from "node:assert/strict";

// See db.test.ts for why DATABASE_URL is stubbed before a dynamic import.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const { pool } = await import("../db.ts");
const { computeAccessibility } = await import("./accessibility.ts");

// Routes a mocked pool.query call by which table its SQL touches, since
// computeAccessibility fans out to two distinct queries in parallel.
function withMockQuery(
  { roadRows, transitCount }: { roadRows: { road_class: string | null }[]; transitCount: number },
  fn: () => Promise<void>
): Promise<void> {
  const originalQuery = pool.query;
  pool.query = (async (text: string) => {
    if (text.includes("FROM road_segments")) return { rows: roadRows };
    if (text.includes("FROM places")) return { rows: [{ n: String(transitCount) }] };
    throw new Error(`Unexpected query in test: ${text}`);
  }) as typeof pool.query;
  return fn().finally(() => {
    pool.query = originalQuery;
  });
}

test("computeAccessibility blends road classification and transit count with the documented 0.75/0.25 weights", async () => {
  await withMockQuery({ roadRows: [{ road_class: "primary" }], transitCount: 1 }, async () => {
    // roadScore=100 (primary), transitScore=min(100, 1*50)=50
    // 0.75*100 + 0.25*50 = 75 + 12.5 = 87.5
    const score = await computeAccessibility(41.25, -95.93);
    assert.equal(score, 87.5);
  });
});

test("computeAccessibility falls back to the default road score when no road segment is found nearby", async () => {
  await withMockQuery({ roadRows: [], transitCount: 0 }, async () => {
    // roadScore=50 (default, no road found), transitScore=0
    // 0.75*50 + 0.25*0 = 37.5
    const score = await computeAccessibility(41.25, -95.93);
    assert.equal(score, 37.5);
  });
});

test("computeAccessibility falls back to the default road score for an unrecognized road class", async () => {
  await withMockQuery({ roadRows: [{ road_class: "unknown" }], transitCount: 0 }, async () => {
    // "unknown" isn't in ROAD_CLASS_SCORES, so it falls to the default (50),
    // same value unclassified maps to but via the ?? fallback, not the map.
    const score = await computeAccessibility(41.25, -95.93);
    assert.equal(score, 37.5);
  });
});

test("computeAccessibility falls back to the default road score when road_class is null", async () => {
  await withMockQuery({ roadRows: [{ road_class: null }], transitCount: 0 }, async () => {
    const score = await computeAccessibility(41.25, -95.93);
    assert.equal(score, 37.5);
  });
});

test("computeAccessibility caps the transit score at 100 for two or more nearby stops", async () => {
  await withMockQuery({ roadRows: [{ road_class: "primary" }], transitCount: 3 }, async () => {
    // transitScore=min(100, 3*50)=100 (capped, not 150)
    // 0.75*100 + 0.25*100 = 100
    const score = await computeAccessibility(41.25, -95.93);
    assert.equal(score, 100);
  });
});
