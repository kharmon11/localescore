const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/**
 * Calls POST /score on the backend. See backend/src/routes/score.js for the
 * request/response shape.
 *
 * @param {{lat: number, lng: number, subtype: string, weights?: object}} params
 * @param {AbortSignal} [signal] - aborts the request if a newer one supersedes it
 */
export async function fetchScore({ lat, lng, subtype, weights }, signal) {
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, subtype, weights }),
      signal,
    });
  } catch (err) {
    // A deliberate abort isn't a real failure. Propagate it unchanged.
    if (err.name === "AbortError") throw err;
    // No response was received (dev server down, DNS failure, CORS block,
    // etc). Treat as transient.
    const scoreErr = new Error("Couldn't reach the server. Check your connection and try again.");
    scoreErr.type = "transient";
    throw scoreErr;
  }

  if (!res.ok) {
    let body;
    try {
      body = await res.json();
    } catch {
      // The error response wasn't valid JSON at all. Likely an infra/proxy
      // failure in front of our own Express app (e.g. a platform-level
      // 502/503), not a response our own error-handling code produced.
      // Tagged transient too, since "try again" is the most honest advice
      // available.
      const err = new Error(`Score request failed with status ${res.status}`);
      err.type = "transient";
      throw err;
    }
    const err = new Error(body.error ?? `Score request failed with status ${res.status}`);
    err.type = body.type;
    err.resetAt = body.resetAt;
    throw err;
  }

  return res.json();
}
