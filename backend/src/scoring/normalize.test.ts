import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, percentileRank, saturationScore } from "./normalize.ts";

// clamp

test("clamp passes a value through unchanged when it's within range", () => {
  assert.equal(clamp(5, 0, 10), 5);
});

test("clamp floors a value below the minimum", () => {
  assert.equal(clamp(-5, 0, 10), 0);
});

test("clamp caps a value above the maximum", () => {
  assert.equal(clamp(15, 0, 10), 10);
});

// percentileRank

const BENCHMARK = [1000, 2000, 3000, 4000, 5000];

test("percentileRank returns the percentage of reference values strictly below the given value", () => {
  // 1000 and 2000 are below 3000 -> 2 of 5 -> 40
  assert.equal(percentileRank(3000, BENCHMARK), 40);
});

test("percentileRank returns 0 when the value matches or is below the smallest reference value", () => {
  assert.equal(percentileRank(1000, BENCHMARK), 0);
  assert.equal(percentileRank(0, BENCHMARK), 0);
});

test("percentileRank returns 80 when the value matches the largest reference value (4 of 5 are below it)", () => {
  assert.equal(percentileRank(5000, BENCHMARK), 80);
});

test("percentileRank returns 100 when the value is above every reference value", () => {
  assert.equal(percentileRank(6000, BENCHMARK), 100);
});

test("percentileRank returns a neutral 50 when there's no benchmark data yet", () => {
  assert.equal(percentileRank(3000, null), 50);
  assert.equal(percentileRank(3000, undefined), 50);
  assert.equal(percentileRank(3000, []), 50);
});

// saturationScore

test("saturationScore returns 50 when local competition exactly matches the citywide median", () => {
  assert.equal(saturationScore(2, 2), 50);
});

test("saturationScore penalizes competition well above the citywide median, capped at 0", () => {
  // ratio 4 -> 100 - min(100, 4*50) = 100 - 100 = 0 (the min(100, ...) cap, not just the final clamp)
  assert.equal(saturationScore(8, 2), 0);
});

test("saturationScore rewards competition well below the citywide median", () => {
  // ratio 0.25 -> 100 - (0.25*50) = 87.5
  assert.equal(saturationScore(0.5, 2), 87.5);
});

test("saturationScore returns a neutral 50 when there's no citywide benchmark yet", () => {
  assert.equal(saturationScore(5, null), 50);
  assert.equal(saturationScore(5, undefined), 50);
  assert.equal(saturationScore(5, 0), 50);
  assert.equal(saturationScore(5, -1), 50);
});
