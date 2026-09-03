import { query } from "../db.ts";
import type { IsochroneProfile, IsochroneFeatureCollection } from "../isochroneTypes.ts";

const ORS_BASE_URL = "https://api.heigit.org/openrouteservice/v2/isochrones";

/**
 * Rounds lat/lng to ~11m precision (4 decimal places: 1 decimal degree of
 * latitude is ~111km, so 10^-4 degree is ~11m; 5 decimal places, used here
 * previously, is ~1.1m). This lets two clicks within about 11m of each
 * other share a cache entry, then folds in the travel profile so different
 * subtypes at the same point don't collide.
 *
 * In practice this gives almost no protection against the live ORS/HeiGIT
 * quota: ordinary exploratory map clicks are rarely within 11m of each
 * other, so nearly every click is a cache miss and costs a real API call.
 * It also does nothing for scripts/compute-benchmarks.js's benchmark grid,
 * whose sample points are ~1.7-2.2km apart, confirmed 2026-08-25 while
 * diagnosing a live quota-exhaustion outage. See
 * project_click_quota_architecture_flaw.md (Claude's memory for this repo)
 * for the full writeup; a caching/quota strategy overhaul is planned.
 *
 * Exported so other callers that need to know (not fetch) whether a point is
 * already cached, e.g. scripts/compute-benchmarks.js checking whether a
 * grid point/subtype combo would cost a new OpenRouteService call before
 * deciding whether it's within this run's self-imposed budget, can compute
 * the same key without duplicating this rounding logic (and risking it
 * silently drifting out of sync with the one getIsochrone() actually uses).
 *
 * Only needs mode/rangesMinutes, not the ring weights, so it's typed against
 * that subset of IsochroneProfile rather than the whole thing.
 */
export function buildCacheKey(
  lat: number,
  lng: number,
  { mode, rangesMinutes }: Pick<IsochroneProfile, "mode" | "rangesMinutes">
): string {
  const roundedLat = lat.toFixed(4);
  const roundedLng = lng.toFixed(4);
  return `${roundedLat},${roundedLng},${mode},${rangesMinutes.join("-")}`;
}

// ORS/HeiGIT isochrone requests normally return in well under a second; this
// bounds a hung connection so it fails fast into the retry path instead of
// leaving a live map click stuck indefinitely.
const ORS_REQUEST_TIMEOUT_MS = 10000;

// Real daily quota exhaustion (500/day account cap). Always comes back as
// HTTP 403 with body {"error": "Quota exceeded"}. Not retry-worthy:
// retrying immediately will just fail again.
export class OrsQuotaExceededError extends Error {
  status: number;
  resetAt: Date | null; // null if x-ratelimit-reset was missing

  constructor(status: number, body: string, resetAt: Date | null) {
    super(`OpenRouteService quota exceeded (${status}): ${body}`);
    this.name = "OrsQuotaExceededError";
    this.status = status;
    this.resetAt = resetAt;
  }
}

// Everything else that keeps a request from succeeding: a non-403 HTTP
// error response (502 Bad Gateway has been observed; the documented
// 20-requests/minute cap would also land here as a 429), or the fetch()
// call itself never getting a response at all (dropped connection, DNS
// hiccup, or our own ORS_REQUEST_TIMEOUT_MS firing). Both have been observed
// to resolve on a simple retry, so these are treated as retry-worthy blips
// rather than a hard failure.
export class OrsTransientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OrsTransientError";
  }
}

// A brief pause before the one retry below, giving a genuine network blip
// (dropped packet, DNS hiccup) a moment to clear. Not measured against real
// failures. Short enough to be invisible next to an isochrone request's
// normal latency, long enough to not just immediately repeat the same
// failure.
const ORS_RETRY_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Retries once, only for OrsTransientError. Propagates immediately for
// OrsQuotaExceededError, anything else, or an already-disconnected client.
async function fetchFromOpenRouteServiceWithRetry(
  lat: number,
  lng: number,
  isochroneProfile: Pick<IsochroneProfile, "mode" | "rangesMinutes">,
  signal?: AbortSignal
): Promise<IsochroneFeatureCollection> {
  try {
    return await fetchFromOpenRouteService(lat, lng, isochroneProfile, signal);
  } catch (err) {
    if (!(err instanceof OrsTransientError) || signal?.aborted) throw err;
    await sleep(ORS_RETRY_DELAY_MS);
    return fetchFromOpenRouteService(lat, lng, isochroneProfile, signal);
  }
}

// The return type here is a trust boundary, not a runtime guarantee: ORS's
// actual JSON response is never validated against IsochroneFeatureCollection
// at runtime (this codebase has no schema validator), so a malformed or
// changed upstream response would only surface as a downstream error, not
// here.
async function fetchFromOpenRouteService(
  lat: number,
  lng: number,
  { mode, rangesMinutes }: Pick<IsochroneProfile, "mode" | "rangesMinutes">,
  signal?: AbortSignal
): Promise<IsochroneFeatureCollection> {
  if (!process.env.ORS_API_KEY) {
    throw new Error(
      "ORS_API_KEY is not set. Get a free key at https://openrouteservice.org/dev/#/signup and add it to backend/.env"
    );
  }

  const rangeSeconds = rangesMinutes.map((m) => m * 60);

  let res: Response;
  try {
    res = await fetch(`${ORS_BASE_URL}/${mode}`, {
      method: "POST",
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations: [[lng, lat]], // ORS wants [lng, lat], not [lat, lng]
        range: rangeSeconds,
        range_type: "time",
      }),
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(ORS_REQUEST_TIMEOUT_MS), signal])
        : AbortSignal.timeout(ORS_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // fetch() itself rejected. No HTTP response was ever received, so
    // there's no status code to classify by. Could be a dropped connection,
    // a DNS hiccup (Node's generic "fetch failed"), or the timeout above
    // firing (a DOMException named "TimeoutError"). All three are
    // indistinguishable from here and all three are retry-worthy.
    const message = err instanceof Error ? err.message : String(err);
    throw new OrsTransientError(
      `OpenRouteService isochrone request failed before a response was received: ${message}`,
      { cause: err }
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      // x-ratelimit-reset is Unix epoch seconds (confirmed against a real
      // response), telling us when capacity is expected back.
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000) : null;
      throw new OrsQuotaExceededError(res.status, body, resetAt);
    }
    throw new OrsTransientError(`OpenRouteService isochrone request failed (${res.status}): ${body}`);
  }

  return res.json();
}

interface IsochroneCacheRow {
  geojson: IsochroneFeatureCollection;
}

/**
 * Returns a GeoJSON FeatureCollection of isochrone rings for a point,
 * checking isochrone_cache first before calling OpenRouteService/HeiGIT.
 *
 * On a cache miss, a non-403 failure (bad gateway, dropped connection, or
 * ORS_REQUEST_TIMEOUT_MS elapsing with no response) is retried once after a
 * short delay before giving up; a 403 (quota exhausted) is never retried.
 *
 * @throws {OrsQuotaExceededError} if the account's daily ORS/HeiGIT quota is exhausted
 * @throws {OrsTransientError} if the request fails and the one retry also fails
 */
export async function getIsochrone(
  lat: number,
  lng: number,
  isochroneProfile: IsochroneProfile,
  signal?: AbortSignal
): Promise<IsochroneFeatureCollection> {
  const cacheKey = buildCacheKey(lat, lng, isochroneProfile);

  const cached = await query<IsochroneCacheRow>(
    `SELECT geojson FROM isochrone_cache WHERE cache_key = $1`,
    [cacheKey]
  );
  if (cached.rows.length > 0) {
    return cached.rows[0].geojson;
  }

  const geojson = await fetchFromOpenRouteServiceWithRetry(lat, lng, isochroneProfile, signal);

  await query(
    `INSERT INTO isochrone_cache (cache_key, lat, lng, travel_profile, ranges_minutes, geojson)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (cache_key) DO NOTHING`,
    [
      cacheKey,
      lat,
      lng,
      isochroneProfile.mode,
      isochroneProfile.rangesMinutes,
      geojson,
    ]
  );

  return geojson;
}
