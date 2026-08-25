#!/usr/bin/env node
// Loads Census block group geometry (TIGER) + demographics (ACS 5-year) for
// Douglas (055) and Sarpy (153) counties, NE into the `census_block_groups`
// table. See scripts/README.md for prerequisites.
//
// Two ACS vintages are pulled to approximate the "growth trend" sub-score
// (docs/design.md 2.3). IMPORTANT CAVEAT: the Census Bureau only publishes
// ACS 5-YEAR estimates at the block group level -- 1-year estimates don't
// exist for geographies this small (ACS 1-year is limited to
// populations 65,000+). So "growth trend" here compares two overlapping-ish
// 5-year windows (e.g. 2023 5yr vs 2018 5yr) as an approximation of a real
// year-over-year rate, not a true 1-year change. That's a real limitation
// worth stating in the demo UI, not just in this comment.

import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import pg from "pg";

const STATE_FIPS = "31"; // Nebraska
const COUNTY_FIPS = ["055", "153"]; // Douglas, Sarpy

// Update these when a newer vintage is available -- check
// https://www.census.gov/data/developers/data-sets/acs-5year.html for the
// current release before running this for real. (Confirmed current as of
// 2026-08-19: 2024 is the latest published 5-year vintage.)
const CURRENT_ACS_VINTAGE = 2024; // "2024" 5-year = 2020-2024 estimates
const PRIOR_ACS_VINTAGE = 2019; // "2019" 5-year = 2015-2019 estimates, ~5 years earlier

// CAVEAT beyond the 5yr-vs-5yr one above: PRIOR_ACS_VINTAGE (2019) predates
// the Census Bureau's 2020-redistricting-based block group boundaries, while
// the TIGER geometry loaded below (vintage = CURRENT_ACS_VINTAGE) uses the
// post-2020 boundaries. Some block groups were split/merged/renumbered
// between the two, so a GEOID present in the 2019 ACS response may not exist
// in the geometry table at all -- applyEstimates() below counts and reports
// these misses rather than silently leaving population_prior_vintage NULL.

const ACS_VARIABLES = {
  population: "B01003_001E",
  medianHouseholdIncome: "B19013_001E",
  medianAge: "B01002_001E",
  households: "B11001_001E",
};

const DATA_DIR = new URL("./.data/", import.meta.url).pathname;

async function main() {
  assertEnv();
  ensureDataDir();

  console.log("Step 1/3: downloading + loading TIGER block group geometry...");
  loadBlockGroupGeometry();

  console.log("Step 2/3: fetching current ACS vintage and updating demographics...");
  const currentEstimates = await fetchAcsBlockGroups(CURRENT_ACS_VINTAGE);
  await applyEstimates(currentEstimates, "current");

  console.log("Step 3/3: fetching prior ACS vintage for the growth-trend proxy...");
  const priorEstimates = await fetchAcsBlockGroups(PRIOR_ACS_VINTAGE);
  await applyEstimates(priorEstimates, "prior");

  console.log("Done.");
}

function assertEnv() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Export it (or source backend/.env) first.");
    process.exit(1);
  }
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadBlockGroupGeometry() {
  const zipPath = `${DATA_DIR}tl_${CURRENT_ACS_VINTAGE}_${STATE_FIPS}_bg.zip`;
  const url = `https://www2.census.gov/geo/tiger/TIGER${CURRENT_ACS_VINTAGE}/BG/tl_${CURRENT_ACS_VINTAGE}_${STATE_FIPS}_bg.zip`;

  run(`curl -sL "${url}" -o "${zipPath}"`);
  run(`unzip -o "${zipPath}" -d "${DATA_DIR}"`);

  const shpPath = `${DATA_DIR}tl_${CURRENT_ACS_VINTAGE}_${STATE_FIPS}_bg.shp`;
  const countyClause = COUNTY_FIPS.map((c) => `'${c}'`).join(",");

  // Loads only Douglas+Sarpy block groups, mapping GEOID/COUNTYFP/TRACTCE
  // onto census_block_groups' columns. -nlt PROMOTE_TO_MULTI because the
  // table column is MultiPolygon and TIGER ships plain Polygon.
  //
  // The county filter is folded into the -sql statement's WHERE clause
  // rather than passed as a separate -where flag: ogr2ogr silently ignores
  // -where whenever -sql is also given ("Warning 1: -where clause ignored
  // in combination with -sql", confirmed against a real TIGER2024 shapefile
  // -- without this, the load pulls in all ~1,648 Nebraska block groups
  // instead of Douglas+Sarpy's ~630).
  run(
    `ogr2ogr -f "PostgreSQL" "PG:${process.env.DATABASE_URL}" "${shpPath}" ` +
      `-nln census_block_groups -append -nlt PROMOTE_TO_MULTI ` +
      `-sql "SELECT GEOID AS geoid, STATEFP AS state_fips, COUNTYFP AS county_fips, TRACTCE AS tract_fips FROM tl_${CURRENT_ACS_VINTAGE}_${STATE_FIPS}_bg WHERE COUNTYFP IN (${countyClause})" ` +
      `-lco GEOMETRY_NAME=geom`
  );
}

async function fetchAcsBlockGroups(vintage) {
  const getVars = Object.values(ACS_VARIABLES).join(",");
  const countyParam = COUNTY_FIPS.join(",");
  const url =
    `https://api.census.gov/data/${vintage}/acs/acs5` +
    `?get=${getVars}` +
    `&for=block%20group:*` +
    `&in=state:${STATE_FIPS}+county:${countyParam}` +
    (process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : "");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Census ACS request failed (${res.status}) for vintage ${vintage}: ${await res.text()}`);
  }
  const [header, ...rows] = await res.json();

  return rows.map((row) => {
    const record = Object.fromEntries(header.map((key, i) => [key, row[i]]));
    const geoid = `${record.state}${record.county}${record.tract}${record["block group"]}`;
    return {
      geoid,
      population: toIntOrNull(record[ACS_VARIABLES.population]),
      medianHouseholdIncome: toIntOrNull(record[ACS_VARIABLES.medianHouseholdIncome]),
      medianAge: toFloatOrNull(record[ACS_VARIABLES.medianAge]),
      households: toIntOrNull(record[ACS_VARIABLES.households]),
    };
  });
}

async function applyEstimates(estimates, which) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let matched = 0;
  const unmatchedGeoids = [];
  try {
    for (const est of estimates) {
      let result;
      if (which === "current") {
        result = await pool.query(
          `UPDATE census_block_groups
           SET population = $2, median_household_income = $3, median_age = $4,
               households = $5, acs_vintage = $6, updated_at = now()
           WHERE geoid = $1`,
          [est.geoid, est.population, est.medianHouseholdIncome, est.medianAge, est.households, `${CURRENT_ACS_VINTAGE}-5yr`]
        );
      } else {
        result = await pool.query(
          `UPDATE census_block_groups
           SET population_prior_vintage = $2, population_prior_acs_vintage = $3
           WHERE geoid = $1`,
          [est.geoid, est.population, `${PRIOR_ACS_VINTAGE}-5yr`]
        );
      }
      if (result.rowCount > 0) {
        matched += 1;
      } else {
        unmatchedGeoids.push(est.geoid);
      }
    }
  } finally {
    await pool.end();
  }

  // For "prior", a nonzero miss count is expected (see the boundary-vintage
  // caveat above) -- surfaced here so it's visible rather than a silent gap
  // in population_prior_vintage / the Growth Trend sub-score.
  console.log(
    `  ${which}: matched ${matched}/${estimates.length} GEOIDs against census_block_groups` +
      (unmatchedGeoids.length > 0
        ? `; ${unmatchedGeoids.length} unmatched (no geometry row for that GEOID): ${unmatchedGeoids.slice(0, 5).join(", ")}${unmatchedGeoids.length > 5 ? ", ..." : ""}`
        : "")
  );
}

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function toIntOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null; // Census uses negative sentinel codes for missing data
}

function toFloatOrNull(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
