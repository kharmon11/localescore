import { query } from "../db.js";

// Road classification scores (docs/design.md 2.3: "arterial/collector roads
// score higher than residential streets"). Values are Overture Transportation
// segment `class` values, which follow the same taxonomy as OSM `highway`
// tags (confirmed against a live Douglas+Sarpy download on 2026-08-19, which
// turned up 17 distinct values). 16 are mapped explicitly below; the 17th,
// "unknown" (1,742 segments as of a 2026-08-25 check), isn't listed here and
// falls through to DEFAULT_ROAD_CLASS_SCORE instead -- which happens to also
// be 50, the same as `unclassified`, so this is a deliberate simplification,
// not a bug. Arterial-equivalent (primary/trunk/motorway) scores highest,
// collector-equivalent (secondary/tertiary) in the middle, residential/
// service/pedestrian-only ways lowest. Tune freely -- this mapping is a
// starting point, not a settled answer (same spirit as spatialQueries.js's
// COMPLEMENTARY_CATEGORY_WEIGHTS).
const ROAD_CLASS_SCORES = {
  primary: 100,
  trunk: 95,
  motorway: 90,
  secondary: 85,
  tertiary: 70,
  unclassified: 50,
  residential: 30,
  living_street: 25,
  service: 15,
  track: 10,
  cycleway: 10,
  path: 10,
  footway: 10,
  pedestrian: 10,
  bridleway: 5,
  steps: 5,
};
const DEFAULT_ROAD_CLASS_SCORE = 50; // unknown/null class, or no road found nearby

const NEAREST_ROAD_SEARCH_RADIUS_METERS = 300;

// Same 400m radius as Complementary Draw (docs/design.md 2.3 doesn't specify
// one for transit specifically, so this reuses the "short walk" definition
// already established elsewhere). Categories match the taxonomy note in
// spatialQueries.js: Overture Places has no bus-stop-level transit data for
// this region, only train_station/bus_station, so this signal will be near-
// zero for most points -- a real, documented data limitation, not a bug.
const TRANSIT_RADIUS_METERS = 400;
const TRANSIT_CATEGORIES = ["train_station", "bus_station"];

// Road classification is the primary visibility signal (design.md's main
// focus); transit is a secondary boost, especially relevant for walk-in
// concepts like coffee shops. Weights are our own judgment call, not
// prescribed by docs/design.md.
const ROAD_CLASS_WEIGHT = 0.75;
const TRANSIT_WEIGHT = 0.25;

/**
 * Accessibility & Visibility sub-score (docs/design.md 2.3): a composite of
 * road classification at the point and nearby transit stop count. Corner-lot
 * detection and parking availability are both explicitly out of scope per
 * the design doc ("skip if too fiddly" / "treat as a manual override field
 * rather than an API call for the MVP").
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<number>} 0-100
 */
export async function computeAccessibility(lat, lng) {
  const [roadClassScore, transitScore] = await Promise.all([
    computeRoadClassScore(lat, lng),
    computeTransitScore(lat, lng),
  ]);

  return ROAD_CLASS_WEIGHT * roadClassScore + TRANSIT_WEIGHT * transitScore;
}

async function computeRoadClassScore(lat, lng) {
  // KNN nearest-neighbor via the `<->` operator + GIST index on geom
  // (idx_road_segments_geom); ST_DWithin bounds it to a "some road actually
  // nearby" radius so an isolated click (e.g. deep in a park) falls back to
  // the neutral default rather than matching an arbitrarily distant segment.
  const sql = `
    SELECT road_class
    FROM road_segments
    WHERE ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
    LIMIT 1;
  `;
  const { rows } = await query(sql, [lng, lat, NEAREST_ROAD_SEARCH_RADIUS_METERS]);
  if (rows.length === 0) return DEFAULT_ROAD_CLASS_SCORE;
  return ROAD_CLASS_SCORES[rows[0].road_class] ?? DEFAULT_ROAD_CLASS_SCORE;
}

async function computeTransitScore(lat, lng) {
  const sql = `
    SELECT COUNT(*) AS n
    FROM places
    WHERE ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
    AND category_primary = ANY($4::text[]);
  `;
  const { rows } = await query(sql, [lng, lat, TRANSIT_RADIUS_METERS, TRANSIT_CATEGORIES]);
  const count = Number(rows[0].n);
  return Math.min(100, count * 50); // 1 stop within reach -> 50, 2+ -> 100
}
