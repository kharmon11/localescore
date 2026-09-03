import { test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubscoreChart from "./SubscoreChart";

const FULL_SUBSCORES = {
  demandDensity: 70,
  competitiveSaturation: 55,
  complementaryDraw: 40,
  accessibilityVisibility: 80,
  growthTrend: 50,
};

test("renders all five rows in order with correct labels and values", () => {
  render(<SubscoreChart subscores={FULL_SUBSCORES} notes={{}} />);
  ["Demand density", "Competitive saturation", "Complementary draw", "Accessibility & visibility", "Growth trend"].forEach(
    (label) => expect(screen.getByText(label)).toBeInTheDocument()
  );
  expect(screen.getByText("70")).toBeInTheDocument();
});

test("defaults missing subscores to 0 and still shows note markers", () => {
  render(<SubscoreChart subscores={undefined} notes={undefined} />);
  expect(screen.getAllByText("0")).toHaveLength(5);
  expect(screen.getAllByText("ⓘ")).toHaveLength(5);
});

test("shows a note marker for every row regardless of a dynamic note", () => {
  render(<SubscoreChart subscores={FULL_SUBSCORES} notes={{ growthTrend: "Approximate trend note" }} />);
  const growthRow = screen.getByText("Growth trend").closest(".subscore-row")!;
  expect(growthRow.querySelector(".subscore-note-marker")).toBeInTheDocument();
  const demandRow = screen.getByText("Demand density").closest(".subscore-row")!;
  expect(demandRow.querySelector(".subscore-note-marker")).toBeInTheDocument();
});

test("shows a tooltip with the value and static description on hover, and hides it on mouse leave", () => {
  render(<SubscoreChart subscores={FULL_SUBSCORES} notes={{}} />);
  const demandRow = screen.getByText("Demand density").closest(".subscore-row")!;
  expect(demandRow.querySelector(".subscore-tooltip")).not.toBeInTheDocument();

  fireEvent.mouseEnter(demandRow);
  expect(demandRow.querySelector(".subscore-tooltip")).toHaveTextContent(/Estimates how many people live/);
  expect(demandRow.querySelector(".subscore-tooltip-note")).not.toBeInTheDocument();

  fireEvent.mouseLeave(demandRow);
  expect(demandRow.querySelector(".subscore-tooltip")).not.toBeInTheDocument();
});

test("layers the dynamic note below the static description when both are present", () => {
  render(<SubscoreChart subscores={FULL_SUBSCORES} notes={{ growthTrend: "Approximate trend note" }} />);
  const growthRow = screen.getByText("Growth trend").closest(".subscore-row")!;

  fireEvent.mouseEnter(growthRow);
  const tooltip = growthRow.querySelector(".subscore-tooltip")!;
  expect(tooltip).toHaveTextContent(/Compares the trade area's population/);
  expect(tooltip.querySelector(".subscore-tooltip-note")).toHaveTextContent("Approximate trend note");
});

test("clamps the bar width to 0-100 but displays the raw value", () => {
  render(<SubscoreChart subscores={{ ...FULL_SUBSCORES, demandDensity: 140 }} notes={{}} />);
  expect(screen.getByText("140")).toBeInTheDocument();
  const demandRow = screen.getByText("Demand density").closest(".subscore-row")!;
  expect((demandRow.querySelector(".subscore-bar") as HTMLElement).style.width).toBe("100%");
});
