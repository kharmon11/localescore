import { query } from "../db.js";

/**
 * Loads the active scoring_profiles row for a subtype, and optionally merges
 * in a request-supplied weights override (docs/design.md section 2.1's
 * "what-if" feature) without persisting anything.
 *
 * @param {string} subtype - 'coffee_shop' | 'fast_casual' | 'dinner_destination'
 * @param {object} [weightsOverride] - partial or full weights object from the request body
 */
export class NotFoundError extends Error {}

export async function loadScoringProfile(subtype, weightsOverride) {
  const { rows } = await query(
    `SELECT subtype, version, weights, normalization_params, isochrone_profile
     FROM scoring_profiles
     WHERE subtype = $1 AND is_active = true
     LIMIT 1`,
    [subtype]
  );

  if (rows.length === 0) {
    throw new NotFoundError(
      `No active scoring profile for subtype "${subtype}". Known subtypes: coffee_shop, fast_casual, dinner_destination.`
    );
  }

  const row = rows[0];
  const weights = weightsOverride
    ? { ...row.weights, ...weightsOverride }
    : row.weights;

  return {
    subtype: row.subtype,
    version: row.version,
    weights,
    normalizationParams: row.normalization_params,
    isochroneProfile: row.isochrone_profile,
    isOverridden: Boolean(weightsOverride),
  };
}
