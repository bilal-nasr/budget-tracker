// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Switch } from "./switch";

afterEach(cleanup);

it("is a labelled switch that reports the new state when pressed", () => {
  const onChange = vi.fn();
  render(<label><span id="l">Email</span><Switch checked={false} onChange={onChange} aria-labelledby="l" /></label>);
  const control = screen.getByRole("switch", { name: "Email" });
  expect(control).toHaveProperty("checked", false);
  fireEvent.click(control);
  expect(onChange).toHaveBeenCalledWith(true);
});

it("shows the on state and can be disabled", () => {
  render(<Switch checked disabled onChange={() => {}} aria-labelledby="x" />);
  const control = screen.getByRole("switch");
  expect(control).toHaveProperty("checked", true);
  expect(control).toHaveProperty("disabled", true);
});
