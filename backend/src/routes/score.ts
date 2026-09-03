import { Router } from "express";
import type { Request, Response } from "express";
import { loadScoringProfile, NotFoundError } from "../scoring/profiles.ts";
import { getIsochrone, OrsQuotaExceededError, OrsTransientError } from "../services/isochrone.ts";
import { computeRawMetrics } from "../services/spatialQueries.ts";
import { computeScore } from "../scoring/engine.ts";
import type { Weights } from "../scoring/engine.ts";

export const scoreRouter = Router();

// Maps a subtype to the Overture Places `category_primary` value(s) counted
// as "direct competition" in computeCompetitorsPer1000, matched via SQL
// `LIKE ANY(...)` (plain entries behave as exact matches; "%_restaurant" is
// a real wildcard). Extend as more subtypes are added.
//
// Overture's Places taxonomy is flat (no more dotted hierarchy like
// "eat_and_drink.restaurant.coffee_shop"), confirmed against a live
// Douglas+Sarpy download on 2026-08-19, which also turned up 78 distinct
// "<cuisine>_restaurant" categories, too many/volatile to hand-enumerate,
// hence the suffix pattern for dinner_destination rather than a fixed list.
// See the longer note in spatialQueries.ts's COMPLEMENTARY_CATEGORY_WEIGHTS.
//
// Exported so scripts/compute-benchmarks.js can use the exact same
// subtype -> competitor-category mapping when building per-subtype
// benchmarks, rather than a second hand-maintained copy silently drifting
// out of sync with what /score actually uses. This object is also the
// canonical source of the Subtype type below, for the same reason:
// profiles.ts and engine.ts both import it from here rather than each
// keeping their own copy of the three subtype names.
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

export type Subtype = keyof typeof SUBTYPE_COMPETITOR_CATEGORY_PATTERNS;

export function validateRequest({
  lat,
  lng,
  subtype,
}: {
  lat: unknown;
  lng: unknown;
  subtype: unknown;
}): string | null {
  if (typeof lat !== "number" || lat < -90 || lat > 90) {
    return "lat must be a number between -90 and 90";
  }
  if (typeof lng !== "number" || lng < -180 || lng > 180) {
    return "lng must be a number between -180 and 180";
  }
  if (typeof subtype !== "string" || !Object.keys(SUBTYPE_COMPETITOR_CATEGORY_PATTERNS).includes(subtype)) {
    return `subtype must be one of: ${Object.keys(SUBTYPE_COMPETITOR_CATEGORY_PATTERNS).join(", ")}`;
  }
  return null;
}

// '2024-5yr' -> '2020–2024' (a 5-year ACS vintage labeled YYYY covers
// (YYYY-4) through YYYY).
export function formatAcsVintageRange(vintageLabel: string | null | undefined): string | null {
  const match = /^(\d{4})-5yr$/.exec(vintageLabel ?? "");
  if (!match) return null;
  const endYear = Number(match[1]);
  return `${endYear - 4}–${endYear}`;
}

// Growth Trend compares two ACS *5-year* estimates several years apart, not
// a true year-over-year rate: the Census Bureau only publishes 1-year
// estimates for geographies with 65,000+ people, which block groups never
// hit (docs/design.md 2.3, scripts/ingest-census.js). This surfaces that
// limitation to the UI in plain language, with the *actual* years being
// compared (read from the ingested data via rawMetrics, not a hardcoded
// guess; see the vintage-label columns added in
// db/migrations/003_prior_acs_vintage_label.sql) rather than just saying
// "approximate" with no specifics.
export function growthTrendNote(
  currentAcsVintage: string | null | undefined,
  priorAcsVintage: string | null | undefined
): string {
  const current = formatAcsVintageRange(currentAcsVintage);
  const prior = formatAcsVintageRange(priorAcsVintage);
  if (!current || !prior) {
    return "Approximate multi-year trend, not a true year-over-year rate: vintage data unavailable for this trade area.";
  }
  return `Approximate: compares ${prior} vs. ${current} 5-year Census estimates, not a true year-over-year rate (block groups don't get 1-year Census data).`;
}

interface ScoreRequestBody {
  lat?: unknown;
  lng?: unknown;
  subtype?: unknown;
  weights?: unknown;
}

scoreRouter.post("/score", async (req: Request<Record<string, never>, unknown, ScoreRequestBody>, res: Response) => {
  const { lat, lng, subtype, weights: weightsOverride } = req.body ?? {};

  const validationError = validateRequest({ lat, lng, subtype });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // validateRequest's runtime checks above already confirm lat/lng are
  // numbers and subtype is one of the known Subtype values, but as a plain
  // string|null-returning function (not a type predicate), it doesn't
  // narrow their types for TypeScript itself. These casts trust that
  // runtime check rather than something the type system verified
  // structurally. Turning validateRequest into a real type predicate would
  // give this proper static safety, but changes its calling convention
  // from an error-message string to a boolean; a bigger change than this
  // pass is making, worth revisiting later.
  const validLat = lat as number;
  const validLng = lng as number;
  const validSubtype = subtype as Subtype;
  // weights is never validated at all today, a pre-existing gap this
  // conversion isn't introducing: a malformed shape just produces NaN
  // subscores downstream rather than a clear error.
  const validWeightsOverride = weightsOverride as Partial<Weights> | undefined;

  // Lets a superseded client request cancel our downstream ORS call instead
  // of wasting a real quota call on a response nobody will read.
  const clientDisconnected = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) clientDisconnected.abort();
  });

  try {
    const profile = await loadScoringProfile(validSubtype, validWeightsOverride);

    const isochroneGeoJSON = await getIsochrone(
      validLat,
      validLng,
      profile.isochroneProfile,
      clientDisconnected.signal
    );

    const rawMetrics = await computeRawMetrics(
      validLat,
      validLng,
      isochroneGeoJSON,
      SUBTYPE_COMPETITOR_CATEGORY_PATTERNS[validSubtype],
      profile.isochroneProfile
    );

    const result = computeScore(rawMetrics, profile);

    if (clientDisconnected.signal.aborted) return;

    res.json({
      ...result,
      subtype: validSubtype,
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
        error: "Openrouteservice data is temporarily unavailable: the daily map-routing quota has been used up. Please try again later.",
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
    console.error(err);
    res.status(500).json({ error: "Failed to compute score. See server logs for details." });
  }
});
