const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/**
 * Calls POST /score on the backend. See backend/src/routes/score.js for the
 * request/response shape.
 *
 * @param {{lat: number, lng: number, subtype: string, weights?: object}} params
 */
export async function fetchScore({ lat, lng, subtype, weights }) {
  const res = await fetch(`${API_BASE_URL}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, subtype, weights }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Score request failed with status ${res.status}`);
  }

  return res.json();
}
