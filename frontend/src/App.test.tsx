import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import App from "./App";
import { fetchScore, ScoreError } from "./api/scoreClient";
import type { ScoreResponse } from "./api/scoreClient";
import type { MapPoint } from "./components/MapView";

vi.mock("./api/scoreClient", () => ({
  fetchScore: vi.fn(),
  ScoreError: class ScoreError extends Error {
    type?: string;
    resetAt?: string;
  },
}));

// Real Mapbox needs WebGL, which jsdom doesn't have -- stand in with two
// buttons that trigger onPointSelected with fixed, distinct coordinates, so
// tests can drive clicks without touching react-map-gl at all. MapView's own
// behavior (real click handling, marker/isochrone rendering) is covered in
// MapView.test.tsx.
vi.mock("./components/MapView", () => ({
  default: ({ onPointSelected }: { onPointSelected: (point: MapPoint) => void }) => (
    <div>
      <button onClick={() => onPointSelected({ lat: 41.1, lng: -95.1 })}>Click Point A</button>
      <button onClick={() => onPointSelected({ lat: 41.2, lng: -95.2 })}>Click Point B</button>
    </div>
  ),
}));

const mockFetchScore = vi.mocked(fetchScore);

const BASE_RESULT: Omit<ScoreResponse, "overall"> = {
  band: "marginal",
  subscores: {
    demandDensity: 1,
    competitiveSaturation: 1,
    complementaryDraw: 1,
    accessibilityVisibility: 1,
    growthTrend: 1,
  },
  subtype: "coffee_shop",
  profileVersion: 1,
  weightsOverridden: false,
  isochrone: null,
  notes: { growthTrend: "" },
};

beforeEach(() => {
  mockFetchScore.mockReset();
});

test("shows the placeholder initially", () => {
  render(<App />);
  expect(screen.getByText("Click a point on the map to score it.")).toBeInTheDocument();
});

test("shows the score after a successful click", async () => {
  mockFetchScore.mockResolvedValueOnce({ ...BASE_RESULT, overall: 75.5 });
  render(<App />);
  fireEvent.click(screen.getByText("Click Point A"));
  expect(screen.getByText("Scoring…")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("75.5")).toBeInTheDocument());
});

test("shows an error with a retry button after a transient failure, and retry re-fetches", async () => {
  const err = new ScoreError("Temporary problem reaching the map-routing service. Please try again.");
  err.type = "transient";
  mockFetchScore.mockRejectedValueOnce(err).mockResolvedValueOnce({ ...BASE_RESULT, overall: 40 });

  render(<App />);
  fireEvent.click(screen.getByText("Click Point A"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText("40")).toBeInTheDocument());
  expect(mockFetchScore).toHaveBeenCalledTimes(2);
});

test("passes the selected subtype to fetchScore", async () => {
  mockFetchScore.mockResolvedValueOnce({ ...BASE_RESULT, overall: 1 });
  render(<App />);
  fireEvent.change(screen.getByLabelText("Concept"), { target: { value: "fast_casual" } });
  fireEvent.click(screen.getByText("Click Point A"));
  await waitFor(() => expect(mockFetchScore).toHaveBeenCalled());
  expect(mockFetchScore.mock.calls[0][0].subtype).toBe("fast_casual");
});

test("silently clears loading and shows no error when fetchScore rejects with an AbortError", async () => {
  // A real abort throws a DOMException, which does NOT extend Error, the
  // same reasoning as scoreClient.ts's own abort handling -- this exercises
  // App's copy of that duck-typed check directly, rather than relying on
  // fetchScore (mocked out entirely in this file) to have already proven it.
  mockFetchScore.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
  render(<App />);
  fireEvent.click(screen.getByText("Click Point A"));
  expect(screen.getByText("Scoring…")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Scoring…")).not.toBeInTheDocument());
  expect(screen.getByText("Click a point on the map to score it.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("aborts the in-flight request's controller when a new point is selected before it resolves", async () => {
  const abortSpy = vi.spyOn(AbortController.prototype, "abort");
  let resolveFirst!: (value: ScoreResponse) => void;
  const firstPromise = new Promise<ScoreResponse>((resolve) => {
    resolveFirst = resolve;
  });
  let resolveSecond!: (value: ScoreResponse) => void;
  const secondPromise = new Promise<ScoreResponse>((resolve) => {
    resolveSecond = resolve;
  });
  mockFetchScore.mockImplementationOnce(() => firstPromise).mockImplementationOnce(() => secondPromise);

  render(<App />);
  fireEvent.click(screen.getByText("Click Point A"));
  expect(abortSpy).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("Click Point B"));
  expect(abortSpy).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveSecond({ ...BASE_RESULT, overall: 20 });
    await secondPromise;
  });
  await act(async () => {
    resolveFirst({ ...BASE_RESULT, overall: 90 });
    await firstPromise;
  });

  abortSpy.mockRestore();
});

test("a slower superseded request never overwrites a faster later one", async () => {
  let resolveFirst!: (value: ScoreResponse) => void;
  const firstPromise = new Promise<ScoreResponse>((resolve) => {
    resolveFirst = resolve;
  });
  let resolveSecond!: (value: ScoreResponse) => void;
  const secondPromise = new Promise<ScoreResponse>((resolve) => {
    resolveSecond = resolve;
  });
  mockFetchScore.mockImplementationOnce(() => firstPromise).mockImplementationOnce(() => secondPromise);

  render(<App />);
  fireEvent.click(screen.getByText("Click Point A"));
  fireEvent.click(screen.getByText("Click Point B"));

  // The second (later) click's request resolves first.
  await act(async () => {
    resolveSecond({ ...BASE_RESULT, overall: 20 });
    await secondPromise;
  });
  expect(screen.getByText("20")).toBeInTheDocument();

  // The first (earlier, superseded) click's request resolves after -- its
  // result must never overwrite the already-displayed one.
  await act(async () => {
    resolveFirst({ ...BASE_RESULT, overall: 90 });
    await firstPromise;
  });
  expect(screen.getByText("20")).toBeInTheDocument();
  expect(screen.queryByText("90")).not.toBeInTheDocument();
});
