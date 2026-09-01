import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubtypeSelector from "./SubtypeSelector.jsx";

test("renders all three subtype options with their labels", () => {
  render(<SubtypeSelector value="coffee_shop" onChange={() => {}} />);
  expect(screen.getByRole("option", { name: "Coffee shop / cafe" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Fast casual / QSR" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Sit-down / dinner destination" })).toBeInTheDocument();
});

test("reflects the given value as selected", () => {
  render(<SubtypeSelector value="fast_casual" onChange={() => {}} />);
  expect(screen.getByLabelText("Concept").value).toBe("fast_casual");
});

test("calls onChange with the new value when changed", () => {
  const onChange = vi.fn();
  render(<SubtypeSelector value="coffee_shop" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Concept"), { target: { value: "dinner_destination" } });
  expect(onChange).toHaveBeenCalledWith("dinner_destination");
});
