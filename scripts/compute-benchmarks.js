#!/usr/bin/env node
// Computes the citywide benchmarks each sub-score normalizes against
// (docs/design.md 2.3) from whatever's currently in census_block_groups and
// places, and writes them into scoring_profiles.normalization_params, one
// subtype at a time. Re-run after ingest-census.js or ingest-overture.sh.
//
// Approach: sample a grid of points across Douglas+Sarpy, compute each raw
// metric at every point using the REAL spatial-query logic the backend uses
// at request time (backend/src/services/spatialQueries.js, imported
// directly below -- not reimplemented here, so this can't silently drift
// out of sync with what /score actually computes), and derive
// percentiles/medians from that sample, per subtype.
//
// REAL ISOCHRONES (rewritten 2026-08-19): earlier versions of this script
// approximated every sample point's trade area with a flat 1.5km-radius
// circle instead of a real isochrone, and computed ONE shared benchmark
// applied identically to all three subtypes. Both were real accuracy
// problems: a circle covers meaningfully more area than a real walking/
// driving isochrone (no rivers, one-way streets, or dead ends to worry
// about), so the "citywide typical" distribution it built didn't match what
// live isochrone-based /score queries actually see -- and a coffee shop's
// 5-10min WALK trade area and a dinner destination's 10-20min DRIVE trade
// area were being benchmarked against the exact same circle regardless.
//
// This version uses real isochrones instead, via the SAME getIsochrone()
// function and isochrone_cache table the live /score endpoint uses -- so
// once a grid point/subtype's isochrone is cached, it costs zero further
// OpenRouteService/HeiGIT calls, on this or any future run. Populating the
// cache for all ~2,775 point/subtype combinations (925 points x 3 subtypes)
// takes several days no matter how it's budgeted, given the real quota
// (see QUOTA NOTE below) -- so this script self-limits to
// MAX_NEW_ORS_CALLS_PER_RUN new calls per invocation and stops making new
// calls once it hits that limit (already-cached combos are still free and
// keep getting used). It NEVER writes a partial benchmark: a subtype's
// normalization_params only get updated once every grid point has a real,
// cached isochrone for that subtype's travel profile -- re-run the script
// (the next day, once the daily quota resets) to finish any subtype it
// couldn't complete this time.
//
// QUOTA NOTE (2026-08-19): docs/design.md's original "2,500 requests/day"
// claim was for the old api.openrouteservice.org tier. That domain is being
// shut off entirely on 2026-08-24 in favor of api.heigit.org (see the
// migration note in backend/src/services/isochrone.js), whose free tier is
// smaller and shaped differently -- confirmed against a real account
// dashboard (https://account.heigit.org/info/plans) on 2026-08-19: Isochrones
// V2 is 500 requests/day, with a separate 20-requests/minute rate limit.
// MAX_NEW_ORS_CALLS_PER_RUN below reserves some of that 500/day for real
// live traffic rather than spending the whole day's quota on this
// background job; the 20/minute cap is handled separately, by
// throttleForOrsCall() actually spacing out the network calls (a budget
// alone doesn't help if 20 of them fire in the same second).
//
// At 400 new calls/day, populating all ~2,775 combinations takes about 7
// daily runs the first time. After that, every future run costs 0 new
// calls unless the sample grid or a subtype's travel profile changes.

import "dotenv/config";
import { pool, query } from "../backend/src/db.js";
import { getIsochrone, buildCacheKey } from "../backend/src/services/isochrone.js";
import { computeRawMetrics } from "../backend/src/services/spatialQueries.js";
import { SUBTYPE_COMPETITOR_CATEGORY_PATTERNS } from "../backend/src/routes/score.js";

const GRID_SPACING_DEGREES = 0.02; // ~1.7km E-W / ~2.2km N-S at this latitude; adjust for denser/coarser sampling
// Matches the corrected Douglas+Sarpy bbox in ingest-overture.sh / scripts/README.md
// (verified 2026-08-19 against the real TIGER county boundary) -- sampling
// with the old, too-tight box here would miss the western edge of the
// ingested data when building citywide benchmarks.
const BBOX = { minLng: -96.52, minLat: 40.94, maxLng: -95.79, maxLat: 41.44 };

// Real quota is 500 isochrone requests/day (see QUOTA NOTE above) -- this
// reserves 100/day of headroom for real live /score traffic and spends the
// rest (400) on populating the benchmark cache.
const MAX_NEW_ORS_CALLS_PER_RUN = 400;

// The 20-requests/minute rate limit is separate from the daily total and
// applies regardless of how much of the daily budget remains -- a plain
// counter cap doesn't help if all 400 calls fire in the same few seconds.
// 3.5s between calls keeps a comfortable margin under the nominal 3s
// (60s/20) minimum, since rate limits are sometimes enforced a little more
// strictly in practice than the published number.
const MIN_MS_BETWEEN_ORS_CALLS = 3500;
let lastOrsCallAt = 0;

async function throttleForOrsCall() {
  const elapsed = Date.now() - lastOrsCallAt;
  if (elapsed < MIN_MS_BETWEEN_ORS_CALLS) {
    await sleep(MIN_MS_BETWEEN_ORS_CALLS - elapsed);
  }
  lastOrsCallAt = Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  assertEnv();

  console.log("Building sample grid...");
  const points = buildGrid();
  console.log(`${points.length} sample points across the bounding box.`);

  const profiles = await loadActiveProfiles();
  console.log(`${profiles.length} active scoring profile(s): ${profiles.map((p) => p.subtype).join(", ")}`);

  let newOrsCalls = 0;
  let anySubtypeFailed = false;

  for (const profile of profiles) {
    console.log(`\n--- ${profile.subtype} ---`);

    const competitorCategoryPatterns = SUBTYPE_COMPETITOR_CATEGORY_PATTERNS[profile.subtype];
    if (!competitorCategoryPatterns) {
      console.warn(`  No competitor category patterns defined for "${profile.subtype}" -- skipping.`);
      continue;
    }

    // Each subtype is wrapped separately so a transient failure partway
    // through one (a network blip on one ORS call, say) doesn't abort
    // subtypes after it in the loop -- including ones that might already be
    // fully cached from a previous run and wouldn't touch the network at
    // all this time.
    try {
      const result = await sampleSubtype(profile, competitorCategoryPatterns, points, newOrsCalls);
      const { samples, deferred } = result;
      newOrsCalls = result.newOrsCalls;

      console.log(
        `  ${samples.length}/${points.length} points sampled` +
          (deferred > 0 ? `, ${deferred} deferred (this run's ORS budget is used up)` : "") +
          ` -- ${newOrsCalls} new ORS calls made so far this run.`
      );

      if (deferred > 0) {
        console.log(
          `  Incomplete -- normalization_params NOT updated for "${profile.subtype}" this run ` +
            `(never writes a benchmark built from fewer than all ${points.length} sample points). ` +
            `Re-run this script tomorrow (once the daily quota resets) to continue.`
        );
        continue;
      }

      // Skip zero-competitor points before taking the median, same as
      // before this rewrite: with subtype-specific (now narrower)
      // competitor matching, many grid points genuinely have zero direct
      // competitors in a short trade area, and letting those drag the
      // median to 0 would trip saturationScore's "no benchmark yet"
      // fallback (normalize.js) for every query of that subtype.
      const populationPercentiles = sortedValues(samples.map((s) => s.population));
      const complementaryDrawPercentiles = sortedValues(samples.map((s) => s.complementaryWeightedCount));
      const citywideMedianCompetitorsPer1000 = median(samples.map((s) => s.competitorsPer1000));

      await query(
        `UPDATE scoring_profiles
         SET normalization_params = normalization_params || $2::jsonb
         WHERE subtype = $1 AND is_active = true`,
        [
          profile.subtype,
          JSON.stringify({
            populationPercentiles,
            complementaryDrawPercentiles,
            citywideMedianCompetitorsPer1000,
            // growthRatePercentiles intentionally left alone here --
            // computing it needs population_prior_vintage populated for the
            // whole grid too; add it once that's reliably available (see
            // the mismatch logging in ingest-census.js for the current gap).
            sampledAt: new Date().toISOString(),
            sampleSize: samples.length,
          }),
        ]
      );
      console.log(`  Updated normalization_params for "${profile.subtype}".`);
    } catch (err) {
      anySubtypeFailed = true;
      console.error(`  Failed while sampling "${profile.subtype}":`, err.message);
      console.error(`  normalization_params NOT updated for "${profile.subtype}" this run. Continuing to the next subtype.`);
    }
  }

  await pool.end();
  console.log(`\nDone. ${newOrsCalls} new OpenRouteService call(s) made this run.`);
  if (anySubtypeFailed) {
    console.error("One or more subtypes failed -- see above. Re-run the script to retry them.");
    process.exitCode = 1;
  }
}

// Samples every grid point for one subtype, using its real (cached-when-
// possible) isochrone. `startingOrsCalls` is this run's running total so
// far across subtypes, so the MAX_NEW_ORS_CALLS_PER_RUN budget is shared
// across all subtypes in one invocation, not reset per subtype.
async function sampleSubtype(profile, competitorCategoryPatterns, points, startingOrsCalls) {
  const samples = [];
  let deferred = 0;
  let newOrsCalls = startingOrsCalls;

  // One query for the whole subtype instead of one per grid point -- tells
  // us up front which points still need a real ORS call, without 925
  // separate round trips to find out the same thing one at a time.
  const cachedKeys = await loadCachedKeys(profile.isochroneProfile);

  for (const point of points) {
    const cacheKey = buildCacheKey(point.lat, point.lng, profile.isochroneProfile);
    const alreadyCached = cachedKeys.has(cacheKey);

    if (!alreadyCached && newOrsCalls >= MAX_NEW_ORS_CALLS_PER_RUN) {
      deferred += 1;
      continue;
    }

    // Only throttle when this call is actually about to hit the network --
    // cache hits proceed immediately, no artificial delay.
    if (!alreadyCached) {
      await throttleForOrsCall();
    }

    // getIsochrone() checks isochrone_cache itself before calling ORS, so
    // this only actually reaches the network on a genuine cache miss.
    const isochroneGeoJSON = await getIsochrone(point.lat, point.lng, profile.isochroneProfile);
    if (!alreadyCached) newOrsCalls += 1;

    const raw = await computeRawMetrics(
      point.lat,
      point.lng,
      isochroneGeoJSON,
      competitorCategoryPatterns,
      profile.isochroneProfile
    );
    samples.push(raw);

    const processed = samples.length + deferred;
    if (processed % 50 === 0) {
      console.log(`  ...${processed}/${points.length} points processed (${newOrsCalls} new ORS calls so far this run)`);
    }
  }

  return { samples, deferred, newOrsCalls };
}

async function loadCachedKeys(isochroneProfile) {
  const { rows } = await query(
    `SELECT cache_key FROM isochrone_cache WHERE travel_profile = $1 AND ranges_minutes = $2`,
    [isochroneProfile.mode, isochroneProfile.rangesMinutes]
  );
  return new Set(rows.map((row) => row.cache_key));
}

async function loadActiveProfiles() {
  const { rows } = await query(
    `SELECT subtype, isochrone_profile FROM scoring_profiles WHERE is_active = true ORDER BY subtype`
  );
  // isochrone_profile already has the shape both getIsochrone/buildCacheKey
  // ({mode, rangesMinutes}) and computeRawMetrics's ringWeights
  // ({primaryRingWeight, secondaryRingWeight}) need -- each just destructures
  // the keys it cares about, so the same object is passed to both untouched.
  return rows.map((row) => ({ subtype: row.subtype, isochroneProfile: row.isochrone_profile }));
}

function buildGrid() {
  const points = [];
  for (let lat = BBOX.minLat; lat <= BBOX.maxLat; lat += GRID_SPACING_DEGREES) {
    for (let lng = BBOX.minLng; lng <= BBOX.maxLng; lng += GRID_SPACING_DEGREES) {
      points.push({ lat, lng });
    }
  }
  return points;
}

function sortedValues(values) {
  return [...values].sort((a, b) => a - b);
}

function median(values) {
  const sorted = sortedValues(values.filter((v) => v > 0));
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function assertEnv() {
  // backend/src/db.js (imported above, transitively) already throws
  // immediately if DATABASE_URL is missing -- this ORS_API_KEY check exists
  // separately because nothing checks for that until deep into the sample
  // loop otherwise (the first cache miss), which would mean failing minutes
  // into a run instead of immediately.
  if (!process.env.ORS_API_KEY) {
    console.error(
      "ORS_API_KEY is not set. This script now calls OpenRouteService for real " +
        "isochrones -- export it (see backend/.env.example) before running."
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
