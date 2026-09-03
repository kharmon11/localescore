import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AboutModal from "./AboutModal";

test("renders nothing when closed", () => {
  render(<AboutModal open={false} onClose={() => {}} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("shows the concepts, sub-scores, bands, disclaimer, and GitHub link when open", () => {
  render(<AboutModal open onClose={() => {}} />);
  const dialog = screen.getByRole("dialog");

  ["Coffee shop / cafe", "Fast casual / QSR (quick service restaurant)", "Sit-down / dinner destination"].forEach(
    (label) => expect(dialog).toHaveTextContent(label)
  );
  ["Demand density", "Competitive saturation", "Complementary draw", "Accessibility & visibility", "Growth trend"].forEach(
    (label) => expect(dialog).toHaveTextContent(label)
  );
  ["Strong site", "Good site", "Marginal site", "Weak site"].forEach((label) => expect(dialog).toHaveTextContent(label));
  expect(dialog).toHaveTextContent("proof-of-concept");
  expect(screen.getByRole("link", { name: /View the source on GitHub/ })).toHaveAttribute(
    "href",
    "https://github.com/kharmon11/localescore"
  );
});

test("calls onClose when the close button is clicked", () => {
  const onClose = vi.fn();
  render(<AboutModal open onClose={onClose} />);
  fireEvent.click(screen.getByLabelText("Close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("calls onClose on a backdrop click but not on a click inside the dialog", () => {
  const onClose = vi.fn();
  render(<AboutModal open onClose={onClose} />);
  fireEvent.click(screen.getByRole("dialog"));
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("dialog").parentElement!);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("calls onClose on Escape", () => {
  const onClose = vi.fn();
  render(<AboutModal open onClose={onClose} />);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
