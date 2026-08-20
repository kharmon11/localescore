-- 002_road_segments.sql
-- Road segment geometry + classification, Douglas + Sarpy counties, for the
-- Accessibility & Visibility sub-score (docs/design.md section 2.3, and the
-- "Known gaps" note in README.md this replaces). Sourced from Overture's
-- Transportation theme (`segment` type, subtype='road'), which carries the
-- same road-class taxonomy as OSM `highway` tags (motorway/primary/
-- secondary/.../residential/service/footway/...) since Overture's
-- Transportation theme is itself derived from OpenStreetMap.
--
-- Run against a Neon Postgres database that already has 001_init.sql
-- applied (needs the postgis extension it creates).

CREATE TABLE road_segments (
  overture_id  TEXT PRIMARY KEY,
  road_class   TEXT,                              -- e.g. 'primary', 'residential', 'footway'
  geom         GEOMETRY(LineString, 4326) NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_road_segments_geom ON road_segments USING GIST (geom);
