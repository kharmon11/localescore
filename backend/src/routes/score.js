import { Router } from "express";
import { loadScoringProfile, NotFoundError } from "../scoring/profiles.js";
import { getIsochrone, OrsQuotaExceededError, OrsTransientError } from "../services/isochrone.js";
import { computeRawMetrics } from "../services/spatialQueries.js";
import { computeScore } from "../scoring/engine.js";

export const scoreRouter = Router();

// Maps a subtype to the Overture Places `category_primary` value(s) counted
// as "direct competition" in computeCompetitorsPer1000, matched via SQL
// `LIKE ANY(...)` (plain entries behave as exact matches; "%_restaurant" is
// a real wildcard). Extend as more subtypes are added.
//
// Overture's Places taxonomy is flat (no more dotted hierarchy like
// "eat_and_drink.restaurant.coffee_shop") -- confirmed against a live
// Douglas+Sarpy download on 2026-08-19, which also turned up 78 distinct
// "<cuisine>_restaurant" categories, too many/volatile to hand-enumerate,
// hence the suffix pattern for dinner_destination rather than a fixed list.
// See the longer note in spatialQueries.js's COMPLEMENTARY_CATEGORY_WEIGHTS.
//
// Exported so scripts/compute-benchmarks.js can use the exact same
// subtype -> competitor-category mapping when building per-subtype
// benchmarks, rather than a second hand-maintained copy silently drifting
// out of sync with what /score actually uses.
export const SUBTYPE_COMPETITOR_CATEGORY_PATTERNS = {
  coffee_shop: ["coffee_shop", "coffee_roastery", "cafe"],
  fast_casual: [
    "fast_food_restaurant",
    "sandwich_shop",
    "pizza_restaurant",
    "burger_restaurant",
    "taco_restaurant",
    "mexican_restaurant",
    "chicken_restaurant",
    "chicken_wings_restaurant",
    "texmex_restaurant",
  ],
  dinner_destination: ["restaurant", "%_restaurant"],
};

export function validateRequest({ lat, lng, subtype }) {
  if (typeof lat !== "number" || lat < -90 || lat > 90) {
    return "lat must be a number between -90 and 90";
  }
  if (typeof lng !== "number" || lng < -180 || lng > 180) {
    return "lng must be a number between -180 and 180";
  }
  if (!Object.keys(SUBTYPE_COMPETITOR_CATEGORY_PATTERNS).includes(subtype)) {
    return `subtype must be one of: ${Object.keys(SUBTYPE_COMPETITOR_CATEGORY_PATTERNS).join(", ")}`;
  }
  return null;
}

// '2024-5yr' -> '2020–2024' (a 5-year ACS vintage labeled YYYY covers
// (YYYY-4) through YYYY).
export function formatAcsVintageRange(vintageLabel) {
  const match = /^(\d{4})-5yr$/.exec(vintageLabel ?? "");
  if (!match) return null;
  const endYear = Number(match[1]);
  return `${endYear - 4}–${endYear}`;
}

// Growth Trend compares two ACS *5-year* estimates several years apart, not
// a true year-over-year rate -- the Census Bureau only publishes 1-year
// estimates for geographies with 65,000+ people, which block groups never
// hit (docs/design.md 2.3, scripts/ingest-census.js). This surfaces that
// limitation to the UI in plain language, with the *actual* years being
// compared (read from the ingested data via rawMetrics, not a hardcoded
// guess -- see the vintage-label columns added in
// db/migrations/003_prior_acs_vintage_label.sql) rather than just saying
// "approximate" with no specifics.
export function growthTrendNote(currentAcsVintage, priorAcsVintage) {
  const current = formatAcsVintageRange(currentAcsVintage);
  const prior = formatAcsVintageRange(priorAcsVintage);
  if (!current || !prior) {
    return "Approximate multi-year trend, not a true year-over-year rate -- vintage data unavailable for this trade area.";
  }
  return `Approximate: compares ${prior} vs. ${current} 5-year Census estimates, not a true year-over-year rate (block groups don't get 1-year Census data).`;
}

scoreRouter.post("/score", async (req, res) => {
  const { lat, lng, subtype, weights: weightsOverride } = req.body ?? {};

  const validationError = validateRequest({ lat, lng, subtype });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // Lets a superseded client request cancel our downstream ORS call instead
  // of wasting a real quota call on a response nobody will read.
  const clientDisconnected = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) clientDisconnected.abort();
  });

  try {
    const profile = await loadScoringProfile(subtype, weightsOverride);

    const isochroneGeoJSON = await getIsochrone(lat, lng, profile.isochroneProfile, clientDisconnected.signal);

    const rawMetrics = await computeRawMetrics(
      lat,
      lng,
      isochroneGeoJSON,
      SUBTYPE_COMPETITOR_CATEGORY_PATTERNS[subtype],
      profile.isochroneProfile
    );

    const result = computeScore(rawMetrics, profile);

    if (clientDisconnected.signal.aborted) return;

    res.json({
      ...result,
      subtype,
      profileVersion: profile.version,
      weightsOverridden: profile.isOverridden,
      isochrone: isochroneGeoJSON,
      notes: {
        growthTrend: growthTrendNote(rawMetrics.currentAcsVintage, rawMetrics.priorAcsVintage),
      },
    });
  } catch (err) {
    if (clientDisconnected.signal.aborted) return;

    if (err instanceof NotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof OrsQuotaExceededError) {
      console.warn(err.message);
      return res.status(503).json({
        error: "Openrouteservice data is temporarily unavailable -- the daily map-routing quota has been used up. Please try again later.",
        type: "quota_exceeded",
        resetAt: err.resetAt ? err.resetAt.toISOString() : null,
      });
    }
    if (err instanceof OrsTransientError) {
      console.error(err);
      return res.status(502).json({
        error: "Temporary problem reaching the map-routing service. Please try again.",
        type: "transient",
      });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Failed to compute score. See server logs for details." });
  }
});
