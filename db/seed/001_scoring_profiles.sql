-- 001_scoring_profiles.sql
-- Default scoring profiles for the three MVP restaurant subtypes, matching the
-- default weights in docs/design.md section 2.1.
--
-- normalization_params below are PLACEHOLDERS (marked "TODO") — real values
-- depend on the actual ingested Douglas+Sarpy dataset and should be filled in
-- by scripts/compute-benchmarks.js after running the ETL scripts. The app
-- will run without them but sub-score normalization will be meaningless
-- until they're populated.
--
-- All three subtypes start from the same baseline weights (25/20/20/20/15,
-- matching docs/design.md 2.1) since the doc doesn't yet prescribe different
-- weights per subtype -- that's exactly the kind of tuning this table exists
-- to make easy. Isochrone travel profiles ARE already subtype-specific,
-- per docs/design.md section 1.

INSERT INTO scoring_profiles (subtype, version, is_active, weights, normalization_params, isochrone_profile)
VALUES
(
  'coffee_shop',
  1,
  true,
  '{
    "demandDensity": 0.25,
    "competitiveSaturation": 0.20,
    "complementaryDraw": 0.20,
    "accessibilityVisibility": 0.20,
    "growthTrend": 0.15
  }'::jsonb,
  '{
    "TODO": "populate via scripts/compute-benchmarks.js after ETL",
    "citywideMedianCompetitorsPer1000": null,
    "populationPercentiles": null,
    "complementaryDrawPercentiles": null,
    "growthRatePercentiles": null
  }'::jsonb,
  '{
    "mode": "foot-walking",
    "rangesMinutes": [5, 10],
    "primaryRingWeight": 0.7,
    "secondaryRingWeight": 0.3
  }'::jsonb
),
(
  'fast_casual',
  1,
  true,
  '{
    "demandDensity": 0.25,
    "competitiveSaturation": 0.20,
    "complementaryDraw": 0.20,
    "accessibilityVisibility": 0.20,
    "growthTrend": 0.15
  }'::jsonb,
  '{
    "TODO": "populate via scripts/compute-benchmarks.js after ETL",
    "citywideMedianCompetitorsPer1000": null,
    "populationPercentiles": null,
    "complementaryDrawPercentiles": null,
    "growthRatePercentiles": null
  }'::jsonb,
  '{
    "mode": "driving-car",
    "rangesMinutes": [5, 10],
    "primaryRingWeight": 0.7,
    "secondaryRingWeight": 0.3
  }'::jsonb
),
(
  'dinner_destination',
  1,
  true,
  '{
    "demandDensity": 0.25,
    "competitiveSaturation": 0.20,
    "complementaryDraw": 0.20,
    "accessibilityVisibility": 0.20,
    "growthTrend": 0.15
  }'::jsonb,
  '{
    "TODO": "populate via scripts/compute-benchmarks.js after ETL",
    "citywideMedianCompetitorsPer1000": null,
    "populationPercentiles": null,
    "complementaryDrawPercentiles": null,
    "growthRatePercentiles": null
  }'::jsonb,
  '{
    "mode": "driving-car",
    "rangesMinutes": [10, 20],
    "primaryRingWeight": 0.7,
    "secondaryRingWeight": 0.3
  }'::jsonb
);
