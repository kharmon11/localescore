#!/usr/bin/env bash
# Downloads Overture Transportation road segments for the Douglas+Sarpy
# bounding box and loads them into the `road_segments` table of your
# Postgres database -- the data behind the Accessibility & Visibility
# sub-score's road-classification component (docs/design.md 2.3; see
# README.md's former "Known gaps" note, now resolved by this +
# backend/src/services/accessibility.ts).
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Export it (or source backend/.env) before running this script." >&2
  exit 1
fi

BBOX="-96.52,40.94,-95.79,41.44" # minLng,minLat,maxLng,maxLat -- see scripts/README.md
OUT_DIR="$(dirname "$0")/.data"
OUT_FILE="$OUT_DIR/overture_segments_douglas_sarpy.geojson"

mkdir -p "$OUT_DIR"

echo "Downloading Overture Transportation segments for bbox $BBOX ..."
# Overture's "segment" type covers roads AND rail (and a few rarer subtypes);
# only 'road' rows are kept in the reshape step below.
overturemaps download --bbox="$BBOX" -f geojson --type=segment -o "$OUT_FILE"

echo "Loading into Postgres (road_segments table) ..."
ogr2ogr \
  -f "PostgreSQL" "PG:${DATABASE_URL}" \
  "$OUT_FILE" \
  -nln road_segments_staging \
  -overwrite \
  -lco GEOMETRY_NAME=geom \
  -lco FID=staging_fid

# `class` is a flat string property on Overture segments (unlike Places'
# nested `categories`/`names`), so ogr2ogr loads it as a plain `character
# varying` column -- no jsonb path/cast needed here, confirmed 2026-08-19
# against a live download. `subtype` distinguishes 'road' from 'rail' (and
# other rarer segment subtypes); only 'road' is relevant to street-visibility
# scoring, so it's filtered out here rather than carried into road_segments.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO road_segments (overture_id, road_class, geom, updated_at)
SELECT
  id AS overture_id,
  class AS road_class,
  ST_SetSRID(geom, 4326) AS geom,
  now()
FROM road_segments_staging
WHERE subtype = 'road'
ON CONFLICT (overture_id) DO UPDATE SET
  road_class = EXCLUDED.road_class,
  geom = EXCLUDED.geom,
  updated_at = now();

DROP TABLE road_segments_staging;
SQL

echo "Done. $(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM road_segments") road segments in road_segments table."
