/**
 * Shapes with no single natural owner file: isochrone.ts produces/caches the
 * GeoJSON, spatialQueries.ts reads it, and score.ts threads the full
 * isochrone profile into both isochrone.ts and spatialQueries.ts. They live
 * here instead of importing from whichever file happened to define them
 * first.
 */

/**
 * A `scoring_profiles` row's isochrone_profile (docs/design.md 2.2), e.g.
 * {"mode":"foot-walking","rangesMinutes":[5,10],"primaryRingWeight":0.7,"secondaryRingWeight":0.3}.
 * `mode` is typed as a plain string, not a literal union like Band: unlike
 * Band, it's not validated anywhere in this app and is passed straight
 * through to OpenRouteService's API as a URL path segment, so it's
 * genuinely open-ended external-API content, not a closed set this
 * codebase defines.
 */
export interface IsochroneProfile {
  mode: string;
  rangesMinutes: number[];
  primaryRingWeight: number;
  secondaryRingWeight: number;
}

/**
 * The isochrone GeoJSON returned by OpenRouteService (or read back from
 * isochrone_cache) and passed through to the frontend. Typed to only what
 * this codebase actually reads: features[].properties.value and
 * features[].geometry, both consumed by services/spatialQueries.ts's
 * splitRings, matching the "only what's used" typing used throughout this
 * conversion. geometry itself is never inspected here, only passed through
 * opaquely (to Postgres via ST_GeomFromGeoJSON, and to the frontend for
 * rendering), so it isn't worth a full GeoJSON geometry type.
 */
export interface IsochroneFeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { value: number };
    geometry: unknown;
  }[];
}
