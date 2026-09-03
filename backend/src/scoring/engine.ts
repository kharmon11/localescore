import { percentileRank, saturationScore, clamp } from "./normalize.ts";

/** The five sub-scores computed for every candidate site (docs/design.md 2.1). */
export interface Subscores {
  demandDensity: number;
  competitiveSaturation: number;
  complementaryDraw: number;
  accessibilityVisibility: number;
  growthTrend: number;
}

/** Only the fields computeScore itself reads; see the note above computeScore. */
export interface RawMetricsForScoring {
  population: number;
  competitorsPer1000: number;
  complementaryWeightedCount: number;
  accessibilityRaw: number;
  growthRatePct: number;
}

/** A `scoring_profiles` row's weights (docs/design.md 2.1): one weight per sub-score, same keys as Subscores. */
export type Weights = Record<keyof Subscores, number>;

/** A `scoring_profiles` row's normalization_params (docs/design.md 2.3): the citywide benchmarks each sub-score is compared against. */
export interface NormalizationParams {
  populationPercentiles: number[] | null | undefined;
  citywideMedianCompetitorsPer1000: number | null | undefined;
  complementaryDrawPercentiles: number[] | null | undefined;
  growthRatePercentiles: number[] | null | undefined;
}

/** Only the fields computeScore itself reads from a scoring_profiles row. */
export interface ScoringProfileForScoring {
  subtype: string;
  weights: Weights;
  normalizationParams: NormalizationParams;
}

/** Output bands from docs/design.md section 2.4. */
export type Band = "strong" | "good" | "marginal" | "weak";

export interface ScoreResult {
  overall: number;
  band: Band;
  subscores: Subscores;
}

/** Bands from docs/design.md section 2.4. */
export function scoreBand(overall: number): Band {
  if (overall >= 80) return "strong";
  if (overall >= 60) return "good";
  if (overall >= 40) return "marginal";
  return "weak";
}

/**
 * Pure scoring function: no I/O, no database, no API calls. This is what
 * makes the calculation testable and tunable (docs/design.md section 2.1):
 * every number that affects the outcome comes in through `rawMetrics` or
 * `profile`, nothing is hardcoded here.
 *
 * Both parameters are typed as the minimal shape this function actually
 * reads, not the full shape their real callers happen to produce (e.g.
 * services/spatialQueries.ts's real output also carries ACS vintage labels
 * this function never touches), a function's parameter type should
 * describe what it needs, and the fuller real object still satisfies it.
 */
export function computeScore(rawMetrics: RawMetricsForScoring, profile: ScoringProfileForScoring): ScoreResult {
  const { weights, normalizationParams } = profile;

  const subscores: Subscores = {
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
    // (see services/spatialQueries.ts) rather than a percentile rank against
    // other points, so it just gets clamped/passed through here.
    accessibilityVisibility: clamp(rawMetrics.accessibilityRaw, 0, 100),
    growthTrend: percentileRank(
      rawMetrics.growthRatePct,
      normalizationParams.growthRatePercentiles
    ),
  };

  // Written out field by field rather than looping over Object.keys(weights):
  // there are only ever exactly five sub-scores, fixed by docs/design.md 2.1,
  // so this avoids the dynamic-key indexing that would otherwise need a cast
  // (Object.keys() always returns plain string[] in TypeScript, regardless of
  // how precisely the object itself is typed).
  const weightSum =
    weights.demandDensity +
    weights.competitiveSaturation +
    weights.complementaryDraw +
    weights.accessibilityVisibility +
    weights.growthTrend;
  if (Math.abs(weightSum - 1) > 0.01) {
    // Don't fail silently on a misconfigured scoring_profiles row: a
    // weight set that doesn't sum to ~1.0 will quietly produce a score
    // that isn't on a 0-100 scale, which is worse than an explicit error.
    throw new Error(
      `Scoring profile weights sum to ${weightSum.toFixed(3)}, expected 1.0. Fix the scoring_profiles row for subtype "${profile.subtype}".`
    );
  }

  const overall = clamp(
    weights.demandDensity * subscores.demandDensity +
      weights.competitiveSaturation * subscores.competitiveSaturation +
      weights.complementaryDraw * subscores.complementaryDraw +
      weights.accessibilityVisibility * subscores.accessibilityVisibility +
      weights.growthTrend * subscores.growthTrend,
    0,
    100
  );

  return {
    overall: Math.round(overall * 10) / 10,
    band: scoreBand(overall),
    subscores: {
      demandDensity: round1(subscores.demandDensity),
      competitiveSaturation: round1(subscores.competitiveSaturation),
      complementaryDraw: round1(subscores.complementaryDraw),
      accessibilityVisibility: round1(subscores.accessibilityVisibility),
      growthTrend: round1(subscores.growthTrend),
    },
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
