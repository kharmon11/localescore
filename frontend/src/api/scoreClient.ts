const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

// The two error "type" values the backend actually sends (see
// backend/src/routes/score.ts) -- a closed set both sides of this app agree
// on, unlike open external data, so a literal union is appropriate here the
// same way Band is on the backend.
export type ScoreErrorType = "transient" | "quota_exceeded";

export class ScoreError extends Error {
  type?: ScoreErrorType;
  resetAt?: string;
}

interface ScoreErrorBody {
  error?: string;
  type?: ScoreErrorType;
  resetAt?: string;
}

export interface ScoreSubscores {
  demandDensity: number;
  competitiveSaturation: number;
  complementaryDraw: number;
  accessibilityVisibility: number;
  growthTrend: number;
}

// Matches the backend's own Band type (docs/design.md 2.4) -- a closed set
// this app's own backend defines, unlike ScoreErrorType's counterpart above.
export type Band = "strong" | "good" | "marginal" | "weak";

export interface ScoreResponse {
  overall: number;
  band: Band;
  subscores: ScoreSubscores;
  subtype: string;
  profileVersion: number;
  weightsOverridden: boolean;
  // Passed straight through to react-map-gl's <Source data={...}> without
  // this app ever inspecting its contents, same "only what's used" reasoning
  // as the backend's IsochroneFeatureCollection geometry field.
  isochrone: unknown;
  notes: { growthTrend: string };
}

export interface ScoreParams {
  lat: number;
  lng: number;
  subtype: string;
  weights?: Record<string, number>;
}

/**
 * Calls POST /score on the backend. See backend/src/routes/score.ts for the
 * request/response shape. The response types here are a declared trust
 * boundary, not a runtime guarantee: nothing on the frontend validates that
 * the backend's JSON actually matches ScoreResponse, matching how the
 * backend itself treats its own external API responses (e.g.
 * services/isochrone.ts's OpenRouteService boundary).
 *
 * @param signal aborts the request if a newer one supersedes it
 */
export async function fetchScore(
  { lat, lng, subtype, weights }: ScoreParams,
  signal?: AbortSignal
): Promise<ScoreResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, subtype, weights }),
      signal,
    });
  } catch (err) {
    // A deliberate abort isn't a real failure. Propagate it unchanged. A
    // real abort throws a DOMException, which does NOT extend Error in the
    // prototype chain, so this checks for a "name" property duck-type
    // style rather than requiring `err instanceof Error` (which would
    // silently skip this branch for a real AbortError).
    if (err && typeof err === "object" && "name" in err && err.name === "AbortError") throw err;
    // No response was received (dev server down, DNS failure, CORS block,
    // etc). Treat as transient.
    const scoreErr = new ScoreError("Couldn't reach the server. Check your connection and try again.");
    scoreErr.type = "transient";
    throw scoreErr;
  }

  if (!res.ok) {
    let body: ScoreErrorBody;
    try {
      body = await res.json();
    } catch {
      // The error response wasn't valid JSON at all. Likely an infra/proxy
      // failure in front of our own Express app (e.g. a platform-level
      // 502/503), not a response our own error-handling code produced.
      // Tagged transient too, since "try again" is the most honest advice
      // available.
      const err = new ScoreError(`Score request failed with status ${res.status}`);
      err.type = "transient";
      throw err;
    }
    const err = new ScoreError(body.error ?? `Score request failed with status ${res.status}`);
    err.type = body.type;
    err.resetAt = body.resetAt;
    throw err;
  }

  return res.json();
}
