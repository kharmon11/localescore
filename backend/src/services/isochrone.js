import { query } from "../db.js";

// api.openrouteservice.org is being shut off entirely on 2026-08-24 in favor
// of api.heigit.org (confirmed against the official deprecation announcement,
// https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912,
// 2026-08-19). Same API key, same request/response shape -- only the base
// URL changes. NOTE: no trailing slash after "openrouteservice" below --
// another user's migration report on that same forum hit a 405 error from
// exactly that (https://ask.openrouteservice.org/t/error-moving-from-api-openrouteservice-org-in-favour-of-api-heigit-org/7915).
const ORS_BASE_URL = "https://api.heigit.org/openrouteservice/v2/isochrones";

/**
 * Returns a GeoJSON FeatureCollection of isochrone rings for a point,
 * checking isochrone_cache first (docs/design.md section 3.2) before
 * calling OpenRouteService/HeiGIT. This is what keeps a demo well inside
 * the isochrones quota under repeated clicks -- note that quota is much
 * smaller than docs/design.md's original "2,500 requests/day" claim (that
 * was accurate for the old api.openrouteservice.org tier, not the current
 * HeiGIT one; a real account dashboard checked 2026-08-19 showed 500 total
 * + a 20-requests/minute cap for Isochrones V2, not a flat daily count).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{mode: string, rangesMinutes: number[]}} isochroneProfile
 */
export async function getIsochrone(lat, lng, isochroneProfile) {
  const cacheKey = buildCacheKey(lat, lng, isochroneProfile);

  const cached = await query(
    `SELECT geojson FROM isochrone_cache WHERE cache_key = $1`,
    [cacheKey]
  );
  if (cached.rows.length > 0) {
    return cached.rows[0].geojson;
  }

  const geojson = await fetchFromOpenRouteService(lat, lng, isochroneProfile);

  await query(
    `INSERT INTO isochrone_cache (cache_key, lat, lng, travel_profile, ranges_minutes, geojson)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cache_key) DO NOTHING`,
    [
      cacheKey,
      lat,
      lng,
      isochroneProfile.mode,
      isochroneProfile.rangesMinutes,
      geojson,
    ]
  );

  return geojson;
}

async function fetchFromOpenRouteService(lat, lng, { mode, rangesMinutes }) {
  if (!process.env.ORS_API_KEY) {
    throw new Error(
      "ORS_API_KEY is not set. Get a free key at https://openrouteservice.org/dev/#/signup and add it to backend/.env"
    );
  }

  const rangeSeconds = rangesMinutes.map((m) => m * 60);

  const res = await fetch(`${ORS_BASE_URL}/${mode}`, {
    method: "POST",
    headers: {
      Authorization: process.env.ORS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations: [[lng, lat]], // ORS wants [lng, lat], not [lat, lng]
      range: rangeSeconds,
      range_type: "time",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouteService isochrone request failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Rounds lat/lng to ~11m precision (4 decimal places -- 1 decimal degree of
 * latitude is ~111km, so 10^-4 degree is ~11m; 5 decimal places, used here
 * previously, is ~1.1m). This lets two clicks within about 11m of each
 * other share a cache entry, then folds in the travel profile so different
 * subtypes at the same point don't collide.
 *
 * In practice this gives almost no protection against the live ORS/HeiGIT
 * quota: ordinary exploratory map clicks are rarely within 11m of each
 * other, so nearly every click is a cache miss and costs a real API call.
 * It also does nothing for scripts/compute-benchmarks.js's benchmark grid,
 * whose sample points are ~1.7-2.2km apart -- confirmed 2026-08-25 while
 * diagnosing a live quota-exhaustion outage. See
 * project_click_quota_architecture_flaw.md (Claude's memory for this repo)
 * for the full writeup; a caching/quota strategy overhaul is planned.
 *
 * Exported so other callers that need to know (not fetch) whether a point is
 * already cached -- e.g. scripts/compute-benchmarks.js checking whether a
 * grid point/subtype combo would cost a new OpenRouteService call before
 * deciding whether it's within this run's self-imposed budget -- can compute
 * the same key without duplicating this rounding logic (and risking it
 * silently drifting out of sync with the one getIsochrone() actually uses).
 */
export function buildCacheKey(lat, lng, { mode, rangesMinutes }) {
  const roundedLat = lat.toFixed(4);
  const roundedLng = lng.toFixed(4);
  return `${roundedLat},${roundedLng},${mode},${rangesMinutes.join("-")}`;
}
