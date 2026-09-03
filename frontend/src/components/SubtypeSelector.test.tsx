import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SubtypeSelector from "./SubtypeSelector";

test("renders all three subtype options with their labels", () => {
  render(<SubtypeSelector value="coffee_shop" onChange={() => {}} />);
  expect(screen.getByRole("option", { name: "Coffee shop / cafe" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Fast casual / QSR (quick service restaurant)" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Sit-down / dinner destination" })).toBeInTheDocument();
});

test("reflects the given value as selected", () => {
  render(<SubtypeSelector value="fast_casual" onChange={() => {}} />);
  expect((screen.getByLabelText("Concept") as HTMLSelectElement).value).toBe("fast_casual");
});

test("calls onChange with the new value when changed", () => {
  const onChange = vi.fn();
  render(<SubtypeSelector value="coffee_shop" onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Concept"), { target: { value: "dinner_destination" } });
  expect(onChange).toHaveBeenCalledWith("dinner_destination");
});

test("the info button toggles a popover describing all three concepts", () => {
  render(<SubtypeSelector value="coffee_shop" onChange={() => {}} />);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("What do these concepts mean?"));
  const popover = screen.getByRole("tooltip");
  expect(popover).toHaveTextContent("Coffee shop / cafe");
  expect(popover).toHaveTextContent("Fast casual / QSR (quick service restaurant)");
  expect(popover).toHaveTextContent("Sit-down / dinner destination");

  fireEvent.click(screen.getByLabelText("What do these concepts mean?"));
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("the popover closes on an outside click", () => {
  render(<SubtypeSelector value="coffee_shop" onChange={() => {}} />);
  fireEvent.click(screen.getByLabelText("What do these concepts mean?"));
  expect(screen.getByRole("tooltip")).toBeInTheDocument();

  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("the popover closes on Escape", () => {
  render(<SubtypeSelector value="coffee_shop" onChange={() => {}} />);
  fireEvent.click(screen.getByLabelText("What do these concepts mean?"));
  expect(screen.getByRole("tooltip")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});
