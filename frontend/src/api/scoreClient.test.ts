import { test, expect, vi, afterEach } from "vitest";
import { fetchScore } from "./scoreClient";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetchScore returns parsed JSON on success", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { overall: 50 })));
  const result = await fetchScore({ lat: 1, lng: 2, subtype: "coffee_shop" });
  expect(result).toEqual({ overall: 50 });
});

test("fetchScore throws with the error/type/resetAt from a valid JSON error body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse(503, {
        error: "quota gone",
        type: "quota_exceeded",
        resetAt: "2026-09-01T00:00:00.000Z",
      })
    )
  );
  await expect(fetchScore({ lat: 1, lng: 2, subtype: "coffee_shop" })).rejects.toMatchObject({
    message: "quota gone",
    type: "quota_exceeded",
    resetAt: "2026-09-01T00:00:00.000Z",
  });
});

test("fetchScore tags a non-JSON error body as transient", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }))
  );
  await expect(fetchScore({ lat: 1, lng: 2, subtype: "coffee_shop" })).rejects.toMatchObject({
    message: "Score request failed with status 502",
    type: "transient",
  });
});

test("fetchScore tags a fetch() rejection as transient with a connection-specific message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    })
  );
  await expect(fetchScore({ lat: 1, lng: 2, subtype: "coffee_shop" })).rejects.toMatchObject({
    message: "Couldn't reach the server. Check your connection and try again.",
    type: "transient",
  });
});

test("fetchScore rethrows an AbortError unchanged", async () => {
  const abortErr = new DOMException("The operation was aborted.", "AbortError");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw abortErr;
    })
  );
  await expect(fetchScore({ lat: 1, lng: 2, subtype: "coffee_shop" })).rejects.toBe(abortErr);
});

test("fetchScore forwards the given signal to fetch()", async () => {
  // Typed with fetch's own (url, init) signature so mock.calls[0][1] is
  // known to exist, rather than the zero-arg signature a bare
  // `vi.fn(async () => ...)` would otherwise infer.
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}));
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  await fetchScore({ lat: 1, lng: 2, subtype: "coffee_shop" }, controller.signal);
  expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
});
