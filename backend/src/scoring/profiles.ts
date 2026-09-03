import { query } from "../db.ts";
import type { Weights, NormalizationParams } from "./engine.ts";
import type { IsochroneProfile } from "../isochroneTypes.ts";
import type { Subtype } from "../routes/score.ts";

interface ScoringProfileRow {
  subtype: Subtype;
  version: number;
  weights: Weights;
  normalization_params: NormalizationParams;
  isochrone_profile: IsochroneProfile;
}

export interface ScoringProfile {
  subtype: Subtype;
  version: number;
  weights: Weights;
  normalizationParams: NormalizationParams;
  isochroneProfile: IsochroneProfile;
  isOverridden: boolean;
}

export class NotFoundError extends Error {}

/**
 * Loads the active scoring_profiles row for a subtype, and optionally merges
 * in a request-supplied weights override (docs/design.md section 2.1's
 * "what-if" feature) without persisting anything.
 *
 * `Subtype` is a type-only import from routes/score.ts, the canonical
 * source of the three known subtypes (keyed off
 * SUBTYPE_COMPETITOR_CATEGORY_PATTERNS there). This doesn't create a
 * runtime circular import even though score.ts also imports from this
 * file: type-only imports are erased entirely under this project's
 * verbatimModuleSyntax setup, so nothing is actually required at runtime
 * in this direction.
 */
export async function loadScoringProfile(subtype: Subtype, weightsOverride?: Partial<Weights>): Promise<ScoringProfile> {
  const { rows } = await query<ScoringProfileRow>(
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
