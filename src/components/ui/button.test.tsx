// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./button";

afterEach(cleanup);

it("blocks clicks, announces busy and keeps its label while loading", () => {
  const onClick = vi.fn();
  render(<Button loading onClick={onClick}>Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button).toHaveProperty("disabled", true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector("svg")).not.toBeNull();
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

it("is a plain enabled button when not loading", () => {
  render(<Button>Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button).toHaveProperty("disabled", false);
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(button.querySelector("svg")).toBeNull();
});
