# ETL scripts

One-time (or periodic) ingestion scripts for Douglas + Sarpy counties, NE. Per
`docs/design.md` section 3.1, none of this runs in the request path -- it
populates Neon once, and the backend only ever queries the local database.

## Prerequisites

- `DATABASE_URL` set to your Neon connection string (see `backend/.env.example`)
- [GDAL](https://gdal.org/) installed, for `ogr2ogr` (`brew install gdal` / `apt install gdal-bin`)
- `psql`, for `ingest-overture.sh`/`ingest-roads.sh`'s reshape/upsert step
  (`brew install libpq` on macOS -- note libpq is keg-only, so `psql` won't
  be on `PATH` until you either `brew link --force libpq` or add its bin dir
  to `PATH` yourself; `apt install postgresql-client` on Linux)
- The Overture Maps CLI: `pip install overturemaps` (if the `overturemaps`
  command isn't found afterward and you're on `pyenv`, run `pyenv rehash`)
- A free Census API key: https://api.census.gov/data/key_signup.html (raise
  your rate limit -- as of 2026-08-19 the ACS endpoint used here actually
  redirects to a "Missing Key" page without one, despite what older versions
  of this doc said; get the key)
- `ORS_API_KEY` set (same OpenRouteService key as `backend/.env`), for
  `compute-benchmarks.js` -- it now calls real isochrones (see that script's
  header comment for why), not just the live `/score` endpoint
- `backend/` dependencies installed (`cd backend && npm install`) --
  `compute-benchmarks.js` imports directly from `backend/src/services/` and
  `backend/src/routes/` (isochrone fetching/caching, the spatial-query
  logic, and the subtype -> competitor-category mapping) rather than
  maintaining second, drift-prone copies of that logic in `scripts/`

## Reference: FIPS codes

- Nebraska (state): `31`
- Douglas County: `055`
- Sarpy County: `153`

## Geographic bounding box

`ingest-overture.sh` and `ingest-roads.sh` both use an approximate combined
bounding box for Douglas + Sarpy counties (only for the Overture downloads --
`ingest-census.js` filters block groups by authoritative COUNTYFP instead, so
it isn't affected by this):

```
minLng=-96.52  minLat=40.94  maxLng=-95.79  maxLat=41.44
```

Verified 2026-08-19 against the actual TIGER county boundary
(`tl_2024_us_county.zip`, filtered to STATEFP=31, COUNTYFP IN ('055','153')):
the true combined extent is `minLng=-96.4707 minLat=40.9943 maxLng=-95.8416
maxLat=41.3933`, and the box above pads that by ~0.05° on every side so
isochrones near the county edge aren't cut off by a tight ETL boundary.

(An earlier version of this box -- `minLng=-96.35 minLat=41.00 maxLng=-95.80
maxLat=41.40` -- was *not* generous on the west edge: -96.35 sits about 0.12°
[~10km] inside the true county line, which would have silently excluded
western Douglas/Sarpy County POIs, e.g. around Waterloo/Valley, from
ingestion. If re-verifying this later, re-run the check rather than trusting
the numbers above indefinitely -- county lines don't move, but it's cheap
insurance against a stale copy-paste.)

## Run order

```
node ingest-census.js       # block group geometry + demographics -> census_block_groups
./ingest-overture.sh        # POIs -> places
./ingest-roads.sh           # road segments (Transportation theme) -> road_segments
node compute-benchmarks.js  # citywide medians/percentiles -> scoring_profiles.normalization_params
```

Re-run `ingest-overture.sh` and `ingest-roads.sh` on whatever time-scale you
like (Overture ships monthly). `ingest-census.js` only needs re-running when
a new ACS vintage is released (annually). Always re-run
`compute-benchmarks.js` after any of the above, since the benchmarks are
derived from whatever's currently in the database.

`ingest-roads.sh` populates `road_segments`, used by
`backend/src/services/accessibility.js` for the Accessibility & Visibility
sub-score's road-classification component (docs/design.md 2.3) -- it's not
read by `compute-benchmarks.js` (that sub-score isn't percentile-normalized
against a citywide sample; it's an absolute 0-100 heuristic, same as before).

### `compute-benchmarks.js` needed about a week of daily runs the first time

**Status: this initial population finished 2026-08-19** -- all three
subtypes' `normalization_params` are populated from a full 925-point sample
(verify with `SELECT subtype, normalization_params->>'sampleSize',
normalization_params->>'sampledAt' FROM scoring_profiles WHERE is_active`).
The rest of this section is kept for context on *why* it took several runs,
and applies again if the sample grid or a subtype's isochrone profile ever
changes (see the last paragraph below).

As of the 2026-08-19 rewrite, this script samples a grid of ~925 points
across Douglas+Sarpy for *each* active subtype using real isochrones
(previously a flat-radius circle approximation -- see the script's header
comment for the full history). ~925 points x 3 subtypes is ~2,775 isochrone
requests. The real free-tier quota (see `backend/src/services/isochrone.js`'s
migration note and the QUOTA NOTE in this script's header -- confirmed
against a real account dashboard on 2026-08-19) is 500 requests/day with a
separate 20-requests/minute rate limit, not the 2,500/day this doc used to
claim. The script reserves some of that daily budget for real live traffic
(`MAX_NEW_ORS_CALLS_PER_RUN`, 400 by default) and paces its own calls to
respect the per-minute limit, so a single run now takes on the order of 20+
minutes when it's actually making new calls (not just reusing the cache),
and needs roughly **7 daily runs** to fully populate the grid the first time.

This only matters the **first** time the cache is cold for a given subtype's
travel profile: once a grid point + subtype's isochrone is cached (in the
same `isochrone_cache` table the live app uses), every future run reuses it
for free. In practice: run `node compute-benchmarks.js` once a day, and if it
reports a subtype as incomplete ("deferred... re-run to finish"), just run it
again the next day -- it resumes exactly where it left off and never writes
a benchmark built from fewer than all ~925 sample points for a subtype.
After that first full population, subsequent refreshes (new Overture/Census
data, or just re-running on a schedule) cost **zero** additional isochrone
calls -- only changing a subtype's isochrone travel profile
(`scoring_profiles.isochrone_profile`) or the sample grid itself
(`GRID_SPACING_DEGREES`/`BBOX` in the script) needs fresh isochrones again,
and then only for what actually changed. As of 2026-08-26,
`compute-benchmarks.js` compares each subtype's last sample against the
current data and config, and only resamples what's actually stale.
