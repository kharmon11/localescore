#!/usr/bin/env bash
# Downloads Overture Places for the Douglas+Sarpy bounding box and loads them
# into the Neon `places` table. See scripts/README.md for prerequisites and
# the bounding box caveat.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Export it (or source backend/.env) before running this script." >&2
  exit 1
fi

BBOX="-96.52,40.94,-95.79,41.44" # minLng,minLat,maxLng,maxLat -- see scripts/README.md
OUT_DIR="$(dirname "$0")/.data"
OUT_FILE="$OUT_DIR/overture_places_douglas_sarpy.geojson"

mkdir -p "$OUT_DIR"

echo "Downloading Overture Places for bbox $BBOX ..."
overturemaps download --bbox="$BBOX" -f geojson --type=place -o "$OUT_FILE"

echo "Loading into Neon (places table) ..."
# -nln places targets the existing table (see db/migrations/001_init.sql);
# -append keeps re-runs idempotent-ish (Overture's IDs are stable, so a
# PRIMARY KEY conflict on overture_id would need an upsert -- see note below).
ogr2ogr \
  -f "PostgreSQL" "PG:${DATABASE_URL}" \
  "$OUT_FILE" \
  -nln places_staging \
  -overwrite \
  -lco GEOMETRY_NAME=geom \
  -lco FID=overture_id

# Overture's raw GeoJSON columns don't map 1:1 onto places' simplified schema
# (category, name, and address are nested/structured in the source data), so
# land the raw download in a staging table above, then reshape+upsert here
# rather than trying to get ogr2ogr's field mapping to do it in one step.
#
# NOTE: the `names->>'primary'` / `categories->>'primary'` / `addresses->0->>'freeform'`
# paths below were verified 2026-08-19 against a live Overture Places download
# (ogr2ogr loads these nested GeoJSON properties as `json`-typed Postgres
# columns) -- but Overture's schema does evolve between releases, so before a
# real ingestion run, dump one row (`SELECT * FROM places_staging LIMIT 1`)
# and confirm the column/property names still match before trusting this insert.
#
# `categories->'alternate'` needs an explicit `::jsonb` cast below --
# ogr2ogr's PostgreSQL driver creates `json`-typed columns (not `jsonb`), and
# `jsonb_array_elements_text()` only accepts `jsonb`; without the cast this
# INSERT fails outright with "function jsonb_array_elements_text(json) does
# not exist" (confirmed against a live Neon table, not just read from docs).
#
# It also needs the jsonb_typeof guard below -- `categories.alternate` isn't
# always a JSON array in real Overture data: of 38,810 places downloaded for
# this bbox on 2026-08-19, ~27% had it as JSON `null` (and a smaller number
# had `categories` itself missing entirely) rather than `[]` or a populated
# array. jsonb_array_elements_text() throws "cannot extract elements from a
# scalar" on a JSON null, so anything that isn't actually an array falls
# through to an empty array instead.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO places (overture_id, name, category_primary, category_alternate, geom, address, confidence, updated_at)
SELECT
  id AS overture_id,
  names->>'primary' AS name,
  categories->>'primary' AS category_primary,
  CASE WHEN jsonb_typeof((categories->'alternate')::jsonb) = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text((categories->'alternate')::jsonb))
    ELSE ARRAY[]::text[]
  END AS category_alternate,
  ST_SetSRID(geom, 4326) AS geom, -- places_staging.geom is already SRID 4326
                                  -- (set via -lco GEOMETRY_NAME=geom on the
                                  -- staging load); ST_SetSRID here is a
                                  -- defensive no-op, not a reprojection.
                                  -- "wkb_geometry" (ogr2ogr's unqualified
                                  -- default geometry column name) doesn't
                                  -- exist on this table and errors outright.
  addresses->0->>'freeform' AS address,
  confidence,
  now()
FROM places_staging
ON CONFLICT (overture_id) DO UPDATE SET
  name = EXCLUDED.name,
  category_primary = EXCLUDED.category_primary,
  category_alternate = EXCLUDED.category_alternate,
  geom = EXCLUDED.geom,
  address = EXCLUDED.address,
  confidence = EXCLUDED.confidence,
  updated_at = now();

DROP TABLE places_staging;
SQL

echo "Done. $(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM places") POIs in places table."
