import { query } from "../db.js";
import { computeAccessibility } from "./accessibility.js";

// Complementary-business categories and their foot-traffic-generator weight.
// See docs/design.md 2.3 "Complementary Draw". Tune freely; this list is a
// starting point, not a settled answer.
//
// TAXONOMY NOTE (2026-08-19): this used to be a table of Overture Places
// dotted category *prefixes* (e.g. "office.", "retail.grocery"), matched via
// startsWith(). Real Overture data has no dotted hierarchy anymore -- every
// `category_primary` is a flat leaf string (confirmed against a live
// Douglas+Sarpy download: "office." never matched anything, "retail." never
// matched anything, etc., which would have silently made this whole
// sub-score a no-op). Rewritten below as flat exact-category weights;
// restaurant subtypes (mexican_restaurant, thai_restaurant, ...) are handled
// separately in weightForCategory() via a suffix check rather than listed
// here, since there were 78 distinct "<cuisine>_restaurant" categories in
// that download alone -- too many/volatile to enumerate and keep current.
const COMPLEMENTARY_CATEGORY_WEIGHTS = {
  // offices (workplace foot traffic, esp. lunch-hour)
  corporate_office: 1.0,
  coworking_space: 1.0,
  central_government_office: 1.0,
  federal_government_offices: 1.0,
  local_and_state_government_offices: 1.0,
  health_insurance_office: 1.0,

  // transit -- Places-theme data only surfaces stations, not bus stops
  // (Overture has no bus-stop-level transit data for this region even in
  // the Transportation theme ingested for road_segments -- see the transit
  // note in accessibility.js)
  train_station: 1.2,

  // grocery
  grocery_store: 0.8,
  supermarket: 0.8,
  specialty_grocery_store: 0.8,
  organic_grocery_store: 0.8,
  asian_grocery_store: 0.8,
  international_grocery_store: 0.8,

  // general retail
  retail: 0.5,
  shopping: 0.5,
  department_store: 0.5,
  shopping_center: 0.5,

  // gyms / fitness studios
  gym: 0.7,
  yoga_studio: 0.7,
  pilates_studio: 0.7,
  gymnastics_center: 0.7,
  fitness_trainer: 0.7,
  boxing_gym: 0.7,

  // schools
  elementary_school: 0.6,
  middle_school: 0.6,
  high_school: 0.6,
  school: 0.6,
  preschool: 0.6,
  day_care_preschool: 0.6,
  college_university: 0.6,
  private_school: 0.6,

  // hotels
  hotel: 0.6,
  motel: 0.6,
  resort: 0.6,
  inn: 0.6,

  // arts & entertainment
  cinema: 0.7,
  theatre: 0.7,
  performing_arts: 0.7,
  museum: 0.7,
  history_museum: 0.7,
  arts_and_entertainment: 0.7,

  // other food/drink venues -- draw some shared foot traffic without being
  // direct competition (that's Competitive Saturation's job); restaurants
  // proper are added via the suffix check in weightForCategory() below
  cafe: 0.4,
  coffee_shop: 0.4,
  coffee_roastery: 0.4,
  bar: 0.4,
  sports_bar: 0.4,
  cocktail_bar: 0.4,
  beer_bar: 0.4,
  pub: 0.4,
  brewery: 0.4,
  bakery: 0.4,
  food_truck: 0.4,
};

const COMPLEMENTARY_RADIUS_METERS = 400;

/**
 * ORS returns cumulative isochrones per range value (range[1]'s polygon
 * contains range[0]'s polygon), but doesn't strictly guarantee array order,
 * so sort by range value first. Returns the smallest ("primary") ring and
 * the largest ("outer") ring; the "secondary" ring (the annulus between the
 * two, per docs/design.md section 2.2) is computed as outer-minus-primary
 * in SQL, in computeDemandAndGrowth below.
 *
 * This is the single source of truth for both rings -- every caller that
 * needs "the outer ring" should go through this function rather than
 * re-deriving it, so they can't disagree if ORS ever returns features
 * out of order.
 */
function splitRings(isochroneGeoJSON) {
  const sorted = [...isochroneGeoJSON.features].sort(
    (a, b) => a.properties.value - b.properties.value
  );
  return {
    primaryRingGeoJSON: sorted[0].geometry,
    outerRingGeoJSON: sorted[sorted.length - 1].geometry,
  };
}

async function computeDemandAndGrowth(primaryGeoJSON, outerGeoJSON, { primaryRingWeight, secondaryRingWeight }) {
  // Weight each block group's population by the fraction of its area that
  // falls inside each ring, then combine the two rings per the 70/30 (or
  // whatever the profile specifies) split from docs/design.md 2.2.
  const sql = `
    WITH primary_ring AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
    ),
    outer_ring AS (
      -- Parsed once and reused below (both by secondary_ring and the bbox
      -- filter) instead of calling ST_GeomFromGeoJSON($2) twice per query.
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS geom
    ),
    secondary_ring AS (
      SELECT ST_Difference(
        (SELECT geom FROM outer_ring),
        (SELECT geom FROM primary_ring)
      ) AS geom
    )
    SELECT
      COALESCE(SUM(
        cbg.population * ST_Area(ST_Intersection(cbg.geom, pr.geom)) / NULLIF(ST_Area(cbg.geom), 0)
      ), 0) AS primary_population,
      COALESCE(SUM(
        cbg.population * ST_Area(ST_Intersection(cbg.geom, sr.geom)) / NULLIF(ST_Area(cbg.geom), 0)
      ), 0) AS secondary_population,
      COALESCE(SUM(
        cbg.population_prior_vintage * ST_Area(ST_Intersection(cbg.geom, pr.geom)) / NULLIF(ST_Area(cbg.geom), 0)
      ), 0) AS primary_population_prior,
      COALESCE(SUM(
        cbg.population_prior_vintage * ST_Area(ST_Intersection(cbg.geom, sr.geom)) / NULLIF(ST_Area(cbg.geom), 0)
      ), 0) AS secondary_population_prior,
      -- Representative vintage labels for this trade area, read from the
      -- data itself (not a hardcoded constant) so the "approximate
      -- multi-year trend" caveat shown in the UI can't drift out of sync
      -- with what was actually ingested. MAX() is just "pick one" -- every
      -- row from a single ingest run shares the same vintage in practice.
      MAX(cbg.acs_vintage) AS current_acs_vintage,
      MAX(cbg.population_prior_acs_vintage) AS prior_acs_vintage
    FROM census_block_groups cbg, primary_ring pr, secondary_ring sr, outer_ring o
    WHERE cbg.geom && o.geom; -- bbox filter so the GIST index is used
  `;

  const { rows } = await query(sql, [
    JSON.stringify(primaryGeoJSON),
    JSON.stringify(outerGeoJSON),
  ]);

  const row = rows[0];
  const primaryPopulation = Number(row.primary_population);
  const secondaryPopulation = Number(row.secondary_population);
  const population = primaryRingWeight * primaryPopulation + secondaryRingWeight * secondaryPopulation;

  // Same ring-weighted trade-area definition as `population` above (not just
  // the primary ring) -- docs/design.md 2.3 compares "the trade area's"
  // population across vintages, and Demand Density already blends both
  // rings, so Growth Trend should be measuring the same area.
  const populationPrior =
    primaryRingWeight * Number(row.primary_population_prior) +
    secondaryRingWeight * Number(row.secondary_population_prior);

  const growthRatePct = populationPrior > 0
    ? ((population - populationPrior) / populationPrior) * 100
    : 0;

  return {
    population,
    growthRatePct,
    currentAcsVintage: row.current_acs_vintage,
    priorAcsVintage: row.prior_acs_vintage,
    // Unweighted population across the whole outer ring (primary + secondary
    // combined -- they partition the outer ring exactly, no gaps/overlap).
    // computeCompetitorsPer1000 needs this same number for its per-1000
    // rate; exposed here instead of that function re-querying
    // census_block_groups a second time for an identical result.
    tradeAreaPopulation: primaryPopulation + secondaryPopulation,
  };
}

// `tradeAreaPopulation` comes from computeDemandAndGrowth's query -- the
// population-weighted-by-area-overlap sum over the outer ring is identical
// either way, so this only queries `places` for the count instead of
// re-running that same census_block_groups computation a second time.
async function computeCompetitorsPer1000(outerRingGeoJSON, categoryPatterns, tradeAreaPopulation) {
  if (tradeAreaPopulation <= 0) return 0;

  const sql = `
    WITH trade_area AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
    )
    SELECT COUNT(*) AS competitor_count
    FROM places p, trade_area t
    WHERE p.geom && t.geom
    AND ST_Within(p.geom, t.geom)
    AND p.category_primary LIKE ANY($2::text[]);
  `;

  // categoryPatterns is a fixed, hand-authored array from
  // backend/src/routes/score.js (not derived from user/external input), so
  // no escaping is needed here -- entries with no '%' behave as an exact
  // match under LIKE, entries like '%_restaurant' are real wildcards.
  const { rows } = await query(sql, [JSON.stringify(outerRingGeoJSON), categoryPatterns]);
  return (Number(rows[0].competitor_count) / tradeAreaPopulation) * 1000;
}

function weightForCategory(categoryPrimary) {
  if (!categoryPrimary) return 0;
  // Restaurant subtypes (mexican_restaurant, thai_restaurant, ...) all share
  // the "<cuisine>_restaurant" suffix convention (or the bare "restaurant"
  // leaf) -- see the taxonomy note above COMPLEMENTARY_CATEGORY_WEIGHTS for
  // why these are matched by suffix instead of listed individually.
  if (categoryPrimary === "restaurant" || categoryPrimary.endsWith("_restaurant")) {
    return COMPLEMENTARY_CATEGORY_WEIGHTS.cafe; // same "other food/drink" weight
  }
  return COMPLEMENTARY_CATEGORY_WEIGHTS[categoryPrimary] ?? 0;
}

async function computeComplementaryDraw(lat, lng) {
  // Deliberately simple: fetch category_primary for every POI within the
  // radius, then apply the category-weight table in plain JS. A single
  // dynamic SQL CASE expression could do this in one round trip, but the
  // parameter bookkeeping for a several-dozen-category weight table is easy
  // to get subtly wrong and hard to read later -- not worth it for a query this
  // cheap (a few hundred rows at most, one call per score request).
  const sql = `
    SELECT category_primary
    FROM places
    WHERE ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    );
  `;

  const { rows } = await query(sql, [lng, lat, COMPLEMENTARY_RADIUS_METERS]);

  return rows.reduce((total, { category_primary }) => {
    const weight = weightForCategory(category_primary);
    return total + weight;
  }, 0);
}

/**
 * Computes all raw (pre-normalization) metrics the scoring engine needs for
 * one candidate point, given the isochrone GeoJSON already fetched for it.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} isochroneGeoJSON - FeatureCollection from services/isochrone.js,
 *   expected to have one feature per range value in isochroneProfile.rangesMinutes,
 *   sorted ascending, each polygon cumulative (ORS's default behavior).
 * @param {string[]} competitorCategoryPatterns - Overture `category_primary`
 *   values (or SQL LIKE patterns, e.g. '%_restaurant') counted as direct
 *   competition for this subtype, e.g. ['coffee_shop', 'coffee_roastery', 'cafe']
 * @param {{primaryRingWeight: number, secondaryRingWeight: number}} ringWeights
 */
export async function computeRawMetrics(lat, lng, isochroneGeoJSON, competitorCategoryPatterns, ringWeights) {
  const { primaryRingGeoJSON, outerRingGeoJSON } = splitRings(isochroneGeoJSON);

  const [demandAndGrowth, complementaryWeightedCount, accessibilityRaw] = await Promise.all([
    computeDemandAndGrowth(primaryRingGeoJSON, outerRingGeoJSON, ringWeights),
    computeComplementaryDraw(lat, lng),
    computeAccessibility(lat, lng),
  ]);

  // Runs after (not alongside) computeDemandAndGrowth because it reuses that
  // query's trade-area population instead of re-deriving it -- see the note
  // on computeCompetitorsPer1000 below.
  const { tradeAreaPopulation, ...demandMetrics } = demandAndGrowth;
  const competitorsPer1000 = await computeCompetitorsPer1000(
    outerRingGeoJSON,
    competitorCategoryPatterns,
    tradeAreaPopulation
  );

  return {
    ...demandMetrics,
    competitorsPer1000,
    complementaryWeightedCount,
    accessibilityRaw,
  };
}
