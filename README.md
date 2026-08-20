# Omaha Restaurant Site Score

A portfolio project that scores a candidate location for a restaurant concept
in the Omaha, NE metro (Douglas + Sarpy counties), using free/low-cost data
sources. Full methodology and architecture rationale: [`docs/design.md`](docs/design.md).

## Stack

Vite + React (Mapbox GL JS) frontend · Node.js + Express backend · PostgreSQL
on Neon with PostGIS · OpenRouteService for isochrones · Overture Places +
US Census ACS/TIGER for the underlying data.

## Project layout

```
backend/    Express API -- POST /score
frontend/   Vite/React app -- map UI + score card
db/         SQL migrations + seed data (scoring_profiles, etc.)
scripts/    One-time/periodic ETL: Census + Overture -> Neon
docs/       Design doc (methodology + architecture)
```

## Setup

### 1. Accounts / keys you'll need

- A [Neon](https://neon.tech) project (free tier) with a Postgres connection string.
- A free [Mapbox](https://account.mapbox.com/access-tokens/) access token.
- A free [OpenRouteService](https://openrouteservice.org/dev/#/signup) API key.
- Optionally a [Census API key](https://api.census.gov/data/key_signup.html) (raises the ETL script's rate limit; not required to run it).

### 2. Database

```bash
psql "$DATABASE_URL" -f db/migrations/001_init.sql
psql "$DATABASE_URL" -f db/seed/001_scoring_profiles.sql
```

(`CREATE EXTENSION IF NOT EXISTS postgis;` is included in the migration --
Neon supports PostGIS but doesn't enable it by default on a fresh project.)

### 3. Data ingestion

```bash
cd scripts
npm install
export DATABASE_URL=...   # same connection string as above
node ingest-census.js
./ingest-overture.sh
node compute-benchmarks.js
```

See [`scripts/README.md`](scripts/README.md) for details, prerequisites
(GDAL/`ogr2ogr`, the `overturemaps` CLI), and caveats worth reading before a
real run (approximate bounding box, ACS block-group vintage limitations).

### 4. Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL, ORS_API_KEY
npm run dev
```

### 5. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # fill in VITE_MAPBOX_TOKEN
npm run dev
```

Visit the printed Vite URL (typically http://localhost:5173), click a point
within Douglas or Sarpy county, and a score should come back for the
currently-selected restaurant concept.

## Where the tunable pieces live

- **Scoring weights & normalization benchmarks**: `scoring_profiles` table
  (`db/seed/001_scoring_profiles.sql` seeds the defaults). Edit a row, or
  insert a new `version`, to change how the score is calculated without
  touching any code. `POST /score` also accepts an optional `weights` field
  in the request body to try hypothetical weights for a single query without
  persisting anything.
- **Scoring math**: `backend/src/scoring/engine.js` -- a pure function, unit
  tested in `engine.test.js` (`cd backend && npm test`).
- **Complementary-business category weights**: currently duplicated between
  `backend/src/services/spatialQueries.js` and `scripts/compute-benchmarks.js`
  (flagged in both files) -- worth extracting to a shared module if this
  project grows past the scaffold stage.

## Known gaps / honest caveats

This is a scaffold, not a finished product. Specifically:

- **Accessibility & Visibility** sub-score (docs/design.md 2.3) is now a real
  composite of road classification (nearest Overture Transportation segment's
  `class`, e.g. primary/secondary/residential/service -- see
  `backend/src/services/accessibility.js`) and transit-stop count within
  400m -- ingested via `scripts/ingest-roads.sh`. Corner-lot detection and
  parking availability are still out of scope, per the design doc's own call
  ("skip if too fiddly" / "manual override field, not an API call"). Transit
  signal is thin for this metro: Overture has no bus-stop-level data for
  Douglas/Sarpy, only `train_station`/`bus_station` (11 total across both
  counties as of the 2026-08-19 ingest), so road classification is doing
  most of the work in practice.
- **Growth Trend** compares two ACS 5-year vintages (not a true 1-year
  change) because the Census Bureau doesn't publish 1-year estimates at the
  block-group level -- see the note in `scripts/ingest-census.js`. This is a
  real limit of the underlying data, not something more engineering can fix
  (the only truly-annual alternative, county-level Population Estimates, is
  the same number for every point in a county -- too coarse to be useful for
  comparing nearby sites). Rather than hide it, `POST /score` now returns the
  *actual* vintages being compared (e.g. "2015–2019 vs. 2020–2024"), read
  from the ingested data itself via `population_prior_acs_vintage`
  (`db/migrations/003_prior_acs_vintage_label.sql`), and the UI surfaces this
  as a caveat next to Growth Trend (hover/focus the ⓘ). For trade areas where
  that label is missing -- a real gap, not a bug, from the 2010-vs-2020
  block-group-boundary mismatch already logged by `ingest-census.js` -- the
  UI falls back to a generic "vintage data unavailable" note rather than
  silently showing an unlabeled number.
- **`compute-benchmarks.js`** previously approximated trade areas with a
  fixed-radius circle instead of a real isochrone, and computed one shared
  benchmark applied identically to all three subtypes despite their very
  different trade-area sizes/shapes. As of 2026-08-19 it's rewritten to use
  real isochrones (via the same `isochrone_cache` the live app uses, so
  populating it costs OpenRouteService/HeiGIT calls only once, ever, per
  grid point/subtype) and to build a separate benchmark per subtype.
  **Confirmed complete**: all three subtypes' `normalization_params` are
  populated from a full 925-point sample (verified directly against Neon),
  so this is no longer an open gap.
- **No deployment/hosting** has been set up yet for either the frontend or
  backend (Neon's free tier is confirmed and configured; app hosting is
  not). This project also isn't a git repository yet (`git init` has never
  been run) -- worth deciding early in any deployment work, since most
  Google Cloud deploy paths (Cloud Build triggers, Cloud Run source
  deploys) expect either a connected git repo or an explicit local
  source/Docker build.
