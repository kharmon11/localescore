# LocaleScore

**[localescore.kenharmon.net →](https://localescore.kenharmon.net)**

A site-selection tool for restaurants. Click a point on the map and get back a score (0-100) rating the potential that location has for a given restaurant concept (coffee shop, fast-casual, and sit-down). This rating is broken down into five weighted sub-scores (demand density, competitive saturation, complementary foot traffic, accessibility, and population growth trend).

This tool is a proof-of-concept, rather than a genuine product, built with free data sources:

* Census American Community Survey (ACS)/TIGER
* Overture Places
* OpenStreetMap tags
* OpenRouteService Isochrones

It is limited to the Omaha, NE metro. I am not an expert in this subject, so the scoring methodology is a reasonable-sounding heuristic rather than professionally validated model. Treat the output as illustrative rather than business guidance.

## How it works

Clicking the map generates a trade area for that point, which then draws an isochrone on the map representing approximate travel times for the restaurant concept (5-10 minute walk for a coffee shop, 5-10 minute drive for fast-casual, 10-20 minute drive for a sit-down restaurant).

Five sub-scores are then computed against that trade area: demand density, competitive saturation, complementary foot traffic, accessibility, and population growth trend. These sub-scores are normalized to 0-100 against a citywide benchmark distribution. A weighted sum of the five produces the final score. The weights and normalization benchmarks live in a Postgres table.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React, Mapbox GL JS |
| Backend | Node.js + Express |
| Database | PostgreSQL on Neon, with PostGIS |
| Isochrones | OpenRouteService |
| Spatial data | Overture Places, US Census ACS/TIGER, OpenStreetMap |
| Deploy | Docker on Cloud Run, via GitHub Actions (build → deploy a tagged revision → smoke test → promote traffic) |

## Project layout

```
backend/    Express API -- POST /score
frontend/   Vite/React app -- map UI + score card
db/         SQL migrations + seed data (scoring_profiles, etc.)
scripts/    One-time/periodic ETL: Census + Overture -> Neon
docs/       Design doc (methodology + architecture)
```

## Running it locally

### 1. Accounts / keys you'll need

- A Postgres database with the PostGIS extension available — [Neon](https://neon.tech) has a free tier that works well and is what this project was built against, but any Postgres host that allows installing PostGIS works.
- A [Mapbox](https://account.mapbox.com/access-tokens/) access token.
- An [OpenRouteService](https://openrouteservice.org/dev/#/signup) API key.
- A [Census API key](https://api.census.gov/data/key_signup.html)

### 2. Database

```bash
psql "$DATABASE_URL" -f db/migrations/001_init.sql
psql "$DATABASE_URL" -f db/seed/001_scoring_profiles.sql
```

(`CREATE EXTENSION IF NOT EXISTS postgis;` is included in the migration —
most managed Postgres providers, including Neon, support PostGIS but don't
enable it by default.)

### 3. Data ingestion

```bash
cd scripts
npm install
export DATABASE_URL=...   # your Postgres connection string
node ingest-census.js
./ingest-overture.sh
./ingest-roads.sh
node compute-benchmarks.js
```

See [`scripts/README.md`](scripts/README.md) for prerequisites (GDAL/`ogr2ogr`,
the `overturemaps` CLI) and caveats worth reading before a real run.

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

## Tuning the App

- **Scoring weights & normalization benchmarks** live in the
  `scoring_profiles` table (`db/seed/001_scoring_profiles.sql` seeds the
  defaults), keyed by restaurant subtype and scoring profile version. Edit a
  row, or insert a new version, to change how the score is calculated. `POST /score` also accepts an optional `weights` field to try hypothetical weights for a single query without persisting anything.
- **Scoring math**: `backend/src/scoring/engine.ts` calculates the final score.

## Caveats and Limitations

This is a proof-of-concept, not a finished product, and a few sub-scores
lean on proxies rather than ground truth:

- **Accessibility & Visibility** combines Overture Transportation's road
  classification (primary, motorway, residential, etc.) with rail/bus
  stations. Normal bus stops, corner lots, and parking are not included.
- **Growth Trend** compares two five-year surveys rather than year-over-year
  changes, as that was what was available at the block-group level.
  `POST /score` returns the actual five-year surveys being compared, and
  this is also shown in the UI.
- **Competitive Saturation and Complementary Draw** are built from Overture
  Places category counts rather than a paid foot-traffic panel. A proxy,
  but not actual data.

See [`docs/design.md`](docs/design.md) for the full reasoning behind each of
these trade-offs.
