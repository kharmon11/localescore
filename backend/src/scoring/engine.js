import { percentileRank, saturationScore, clamp } from "./normalize.js";

/**
 * Pure scoring function -- no I/O, no database, no API calls. This is what
 * makes the calculation testable and tunable (docs/design.md section 2.1):
 * every number that affects the outcome comes in through `rawMetrics` or
 * `profile`, nothing is hardcoded here.
 *
 * @param {object} rawMetrics - output of services/spatialQueries.js
 * @param {object} rawMetrics.population - population-weighted count in the trade area
 * @param {number} rawMetrics.competitorsPer1000 - same-category competitors per 1,000 residents in trade area
 * @param {number} rawMetrics.complementaryWeightedCount - weighted count of nearby foot-traffic generators
 * @param {number} rawMetrics.accessibilityRaw - 0-100 heuristic (see services/spatialQueries.js)
 * @param {number} rawMetrics.growthRatePct - population growth rate, trade area, as a percentage
 *
 * @param {object} profile - a row from scoring_profiles (weights + normalization_params)
 *
 * @returns {{overall: number, band: string, subscores: object}}
 */
export function computeScore(rawMetrics, profile) {
  const { weights, normalizationParams } = profile;

  const subscores = {
    demandDensity: percentileRank(
      rawMetrics.population,
      normalizationParams.populationPercentiles
    ),
    competitiveSaturation: saturationScore(
      rawMetrics.competitorsPer1000,
      normalizationParams.citywideMedianCompetitorsPer1000
    ),
    complementaryDraw: percentileRank(
      rawMetrics.complementaryWeightedCount,
      normalizationParams.complementaryDrawPercentiles
    ),
    // Accessibility is already a 0-100 heuristic computed at query time
    // (see services/spatialQueries.js) rather than a percentile rank against
    // other points, so it just gets clamped/passed through here.
    accessibilityVisibility: clamp(rawMetrics.accessibilityRaw, 0, 100),
    growthTrend: percentileRank(
      rawMetrics.growthRatePct,
      normalizationParams.growthRatePercentiles
    ),
  };

  const weightKeys = Object.keys(weights);
  const weightSum = weightKeys.reduce((sum, k) => sum + weights[k], 0);
  if (Math.abs(weightSum - 1) > 0.01) {
    // Don't fail silently on a misconfigured scoring_profiles row -- a
    // weight set that doesn't sum to ~1.0 will quietly produce a score
    // that isn't on a 0-100 scale, which is worse than an explicit error.
    throw new Error(
      `Scoring profile weights sum to ${weightSum.toFixed(3)}, expected 1.0. Fix the scoring_profiles row for subtype "${profile.subtype}".`
    );
  }

  const overall = clamp(
    weightKeys.reduce((sum, key) => sum + weights[key] * (subscores[key] ?? 0), 0),
    0,
    100
  );

  return {
    overall: Math.round(overall * 10) / 10,
    band: scoreBand(overall),
    subscores: mapValues(subscores, (v) => Math.round(v * 10) / 10),
  };
}

/** Bands from docs/design.md section 2.4. */
export function scoreBand(overall) {
  if (overall >= 80) return "strong";
  if (overall >= 60) return "good";
  if (overall >= 40) return "marginal";
  return "weak";
}

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}
