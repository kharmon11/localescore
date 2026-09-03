/**
 * Normalization helpers shared by the sub-score calculations in engine.ts.
 * See docs/design.md section 2.3 for the rationale behind each formula.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Percentile-rank normalization: given a value and a sorted array of
 * reference values (e.g. the same metric computed at many sample points
 * across Douglas+Sarpy), return where `value` falls as a 0-100 score.
 *
 * Used for Demand Density, Complementary Draw, and Growth Trend, where
 * "good" just means "higher than most other candidate points" rather than
 * having a natural absolute scale.
 */
export function percentileRank(value: number, sortedReferenceValues: number[] | null | undefined): number {
  if (!sortedReferenceValues || sortedReferenceValues.length === 0) {
    // No benchmark data yet (normalization_params not populated); return
    // a neutral midpoint rather than throwing, so the API stays usable
    // before scripts/compute-benchmarks.js has run.
    return 50;
  }
  const n = sortedReferenceValues.length;
  let low = 0;
  let high = n;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sortedReferenceValues[mid] < value) low = mid + 1;
    else high = mid;
  }
  return clamp((low / n) * 100, 0, 100);
}

/**
 * Competitive Saturation formula from docs/design.md 2.3:
 *   saturation_score = 100 − min(100, (local_ratio / citywide_median_ratio) × 50)
 *
 * Inverted on purpose: more competitors per capita than the citywide
 * median LOWERS the score, but a market with strong demand can still
 * support several competitors without being penalized to zero.
 */
export function saturationScore(
  localCompetitorsPer1000: number,
  citywideMedianCompetitorsPer1000: number | null | undefined
): number {
  if (!citywideMedianCompetitorsPer1000 || citywideMedianCompetitorsPer1000 <= 0) {
    return 50; // no benchmark yet
  }
  const ratio = localCompetitorsPer1000 / citywideMedianCompetitorsPer1000;
  return clamp(100 - Math.min(100, ratio * 50), 0, 100);
}
