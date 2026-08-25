-- 001_init.sql
-- Initial schema for the Omaha (Douglas + Sarpy county) restaurant site-score project.
-- Run against any Postgres database that allows installing the postgis
-- extension (this project was built against Neon's free tier, but nothing
-- here is Neon-specific).

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Census block groups: ACS demographics + TIGER geometry, Douglas & Sarpy
-- counties, NE only (state FIPS 31; county FIPS 055 = Douglas, 153 = Sarpy).
-- ---------------------------------------------------------------------------
CREATE TABLE census_block_groups (
  geoid                    TEXT PRIMARY KEY,             -- 12-digit Census block group GEOID
  state_fips               TEXT NOT NULL DEFAULT '31',
  county_fips              TEXT NOT NULL,                -- '055' or '153'
  tract_fips               TEXT,
  geom                     GEOMETRY(MultiPolygon, 4326) NOT NULL,

  -- ACS 5-year estimates (see docs/design.md section 2.3 "Demand Density" / "Growth Trend")
  population               INTEGER,
  population_prior_vintage INTEGER,                      -- for the growth-trend sub-score; see
                                                           -- scripts/ingest-census.js for why this is
                                                           -- an earlier 5-year ACS estimate, not a true 1yr-prior value
  median_household_income  INTEGER,
  households               INTEGER,
  median_age               NUMERIC,

  -- LEHD LODES daytime workforce population, optional (nullable until ingested)
  workforce_daytime_pop    INTEGER,

  acs_vintage               TEXT,                         -- e.g. '2023-5yr'
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cbg_geom ON census_block_groups USING GIST (geom);
CREATE INDEX idx_cbg_county ON census_block_groups (county_fips);

-- ---------------------------------------------------------------------------
-- Overture Places POIs, Douglas & Sarpy counties only.
-- ---------------------------------------------------------------------------
CREATE TABLE places (
  overture_id       TEXT PRIMARY KEY,
  name              TEXT,
  category_primary  TEXT,                 -- Overture Places taxonomy leaf category (flat, no dotted
                                           -- hierarchy as of the 2026-08-19 schema), e.g. 'coffee_shop'
  category_alternate TEXT[],
  geom              GEOMETRY(Point, 4326) NOT NULL,
  address           TEXT,
  confidence        NUMERIC,              -- Overture's own confidence score for the record
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_places_geom ON places USING GIST (geom);
CREATE INDEX idx_places_category ON places (category_primary);

-- ---------------------------------------------------------------------------
-- Scoring profiles: this is the tunable-without-a-deploy piece from
-- docs/design.md section 2.1. One active row per restaurant subtype.
-- ---------------------------------------------------------------------------
CREATE TABLE scoring_profiles (
  id                     SERIAL PRIMARY KEY,
  subtype                TEXT NOT NULL,        -- 'coffee_shop' | 'fast_casual' | 'dinner_destination'
  version                INTEGER NOT NULL DEFAULT 1,
  is_active              BOOLEAN NOT NULL DEFAULT true,

  -- Weights must sum to 1.0 (validated in application code, not the DB, since
  -- Postgres check constraints across a jsonb blob are awkward to maintain).
  weights                JSONB NOT NULL,
  -- e.g. {"demandDensity":0.25,"competitiveSaturation":0.20,"complementaryDraw":0.20,
  --       "accessibilityVisibility":0.20,"growthTrend":0.15}

  normalization_params   JSONB NOT NULL,
  -- Citywide benchmarks each sub-score is compared against (see docs/design.md 2.3).
  -- Populated/refreshed by scripts/compute-benchmarks.js after each data ingestion,
  -- since they depend on the actual ingested Douglas+Sarpy dataset.
  -- e.g. {"citywideMedianCompetitorsPer1000":1.8, "populationPercentiles":[...], ...}

  isochrone_profile      JSONB NOT NULL,
  -- Travel profile + ranges for this subtype's trade area (see docs/design.md 2.2).
  -- e.g. {"mode":"foot-walking","rangesMinutes":[5,10]}
  --      {"mode":"driving-car","rangesMinutes":[5,10]}
  --      {"mode":"driving-car","rangesMinutes":[10,20]}

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (subtype, version)
);

-- Only one active profile per subtype at a time.
CREATE UNIQUE INDEX idx_scoring_profiles_one_active_per_subtype
  ON scoring_profiles (subtype) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Isochrone cache: avoid re-hitting OpenRouteService for repeated/nearby
-- points. Keyed on rounded lat/lng + travel profile (see docs/design.md 3.2).
-- ---------------------------------------------------------------------------
CREATE TABLE isochrone_cache (
  cache_key       TEXT PRIMARY KEY,   -- e.g. "41.2565,-95.9345,foot-walking,5-10"
  lat             NUMERIC NOT NULL,
  lng             NUMERIC NOT NULL,
  travel_profile  TEXT NOT NULL,
  ranges_minutes  INTEGER[] NOT NULL,
  geojson         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_isochrone_cache_created ON isochrone_cache (created_at);
