import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore, scoreBand } from "./engine.ts";

const baseProfile = {
  subtype: "coffee_shop",
  weights: {
    demandDensity: 0.25,
    competitiveSaturation: 0.2,
    complementaryDraw: 0.2,
    accessibilityVisibility: 0.2,
    growthTrend: 0.15,
  },
  normalizationParams: {
    populationPercentiles: [1000, 2000, 3000, 4000, 5000],
    citywideMedianCompetitorsPer1000: 2,
    complementaryDrawPercentiles: [1, 2, 3, 4, 5],
    growthRatePercentiles: [-2, 0, 2, 4, 6],
  },
};

test("computeScore returns a 0-100 overall score and matching band", () => {
  const result = computeScore(
    {
      population: 3000,
      competitorsPer1000: 2,
      complementaryWeightedCount: 3,
      accessibilityRaw: 70,
      growthRatePct: 2,
    },
    baseProfile
  );

  assert.ok(result.overall >= 0 && result.overall <= 100);
  assert.equal(result.band, scoreBand(result.overall));
  assert.ok("demandDensity" in result.subscores);
});

test("computeScore throws on a misconfigured profile whose weights don't sum to 1", () => {
  const badProfile = {
    ...baseProfile,
    weights: { ...baseProfile.weights, demandDensity: 0.9 }, // now sums to ~1.65
  };

  assert.throws(
    () =>
      computeScore(
        {
          population: 3000,
          competitorsPer1000: 2,
          complementaryWeightedCount: 3,
          accessibilityRaw: 70,
          growthRatePct: 2,
        },
        badProfile
      ),
    /weights sum to/
  );
});

test("saturationScore penalizes above-median competitor density", () => {
  const highCompetition = computeScore(
    {
      population: 3000,
      competitorsPer1000: 8, // well above the median of 2
      complementaryWeightedCount: 3,
      accessibilityRaw: 70,
      growthRatePct: 2,
    },
    baseProfile
  );
  const lowCompetition = computeScore(
    {
      population: 3000,
      competitorsPer1000: 0.5, // well below the median of 2
      complementaryWeightedCount: 3,
      accessibilityRaw: 70,
      growthRatePct: 2,
    },
    baseProfile
  );

  assert.ok(highCompetition.subscores.competitiveSaturation < lowCompetition.subscores.competitiveSaturation);
});

test("scoreBand thresholds match docs/design.md section 2.4", () => {
  assert.equal(scoreBand(85), "strong");
  assert.equal(scoreBand(65), "good");
  assert.equal(scoreBand(45), "marginal");
  assert.equal(scoreBand(20), "weak");
});
