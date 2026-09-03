import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ScoreCard from "./ScoreCard";

const FULL_SUBSCORES = {
  demandDensity: 70,
  competitiveSaturation: 55,
  complementaryDraw: 40,
  accessibilityVisibility: 80,
  growthTrend: 50,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("shows the placeholder when there is no result, error, or loading", () => {
  render(<ScoreCard result={null} error={null} loading={false} onRetry={() => {}} />);
  expect(screen.getByText("Click a point on the map to score it.")).toBeInTheDocument();
});

test("shows a loading message and nothing else while loading", () => {
  render(<ScoreCard result={null} error={null} loading onRetry={() => {}} />);
  expect(screen.getByText("Scoring…")).toBeInTheDocument();
  expect(screen.queryByText("Click a point on the map to score it.")).not.toBeInTheDocument();
});

test("shows a retry button for a transient error, wired to onRetry", () => {
  const onRetry = vi.fn();
  render(
    <ScoreCard
      result={null}
      error={{ message: "Temporary problem reaching the map-routing service. Please try again.", type: "transient" }}
      loading={false}
      onRetry={onRetry}
    />
  );
  expect(screen.getByText(/Temporary problem/)).toBeInTheDocument();
  expect(screen.queryByText("Click a point on the map to score it.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledOnce();
});

test("formats a same-day quota_exceeded resetAt as a time-only message, with no retry button", () => {
  render(
    <ScoreCard
      result={null}
      error={{ message: "fallback", type: "quota_exceeded", resetAt: "2026-06-15T18:30:00.000Z" }}
      loading={false}
      onRetry={() => {}}
    />
  );
  expect(
    screen.getByText(/^Openrouteservice data is temporarily unavailable\. You can try again at .+\.$/)
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("formats a different-day quota_exceeded resetAt with a date too", () => {
  render(
    <ScoreCard
      result={null}
      error={{ message: "fallback", type: "quota_exceeded", resetAt: "2026-06-16T02:00:00.000Z" }}
      loading={false}
      onRetry={() => {}}
    />
  );
  const text = screen.getByText(/^Openrouteservice data is temporarily unavailable/).textContent;
  expect(text).toMatch(/ on [A-Z][a-z]{2} \d{1,2}\.$/);
});

test("falls back to the raw message when quota_exceeded has no resetAt", () => {
  render(
    <ScoreCard
      result={null}
      error={{ message: "raw fallback message", type: "quota_exceeded", resetAt: null }}
      loading={false}
      onRetry={() => {}}
    />
  );
  expect(screen.getByText("raw fallback message")).toBeInTheDocument();
});

test("shows the raw message with no retry button for an untyped error", () => {
  render(
    <ScoreCard
      result={null}
      error={{ message: "No active scoring profile for subtype x", type: undefined }}
      loading={false}
      onRetry={() => {}}
    />
  );
  expect(screen.getByText("No active scoring profile for subtype x")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("shows the score, band, and subscores when a result is present", () => {
  const result = {
    overall: 62.3,
    band: "good" as const,
    subtype: "coffee_shop",
    profileVersion: 1,
    weightsOverridden: false,
    subscores: FULL_SUBSCORES,
    isochrone: null,
    notes: { growthTrend: "" },
  };
  render(<ScoreCard result={result} error={null} loading={false} onRetry={() => {}} />);
  expect(screen.getByText("62.3")).toBeInTheDocument();
  expect(screen.getByText("Good site")).toBeInTheDocument();
  expect(screen.queryByText(/Custom weights applied/)).not.toBeInTheDocument();
});

test("shows the weightsOverridden note when set", () => {
  const result = {
    overall: 50,
    band: "marginal" as const,
    subtype: "coffee_shop",
    profileVersion: 1,
    weightsOverridden: true,
    subscores: FULL_SUBSCORES,
    isochrone: null,
    notes: { growthTrend: "" },
  };
  render(<ScoreCard result={result} error={null} loading={false} onRetry={() => {}} />);
  expect(screen.getByText("Custom weights applied (not the saved profile).")).toBeInTheDocument();
});
