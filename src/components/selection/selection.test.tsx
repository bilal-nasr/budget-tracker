// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import { SelectionBar, SelectionCheck, SelectToggle } from "./selection-bar";
import { useLongPress } from "./use-long-press";
import { useSelection } from "./use-selection";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function List({ ids, onRemove = () => {}, onOpen = () => {} }: { ids: string[]; onRemove?: (ids: string[]) => void; onOpen?: (id: string) => void }) {
  const selection = useSelection(ids);
  const hold = useLongPress((index) => { if (!selection.selecting) selection.start(ids[index]); });
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <SelectToggle selecting={selection.selecting} label="Select rows" onToggle={() => (selection.selecting ? selection.stop() : selection.start())} />
      <ul {...hold}>
        {ids.map((id) => (
          <li key={id}>
            <button type="button" role={selection.selecting ? "checkbox" : undefined} aria-checked={selection.selecting ? selection.isPicked(id) : undefined}
              onClick={() => (selection.selecting ? selection.toggle(id) : onOpen(id))}>
              {selection.selecting ? <SelectionCheck selected={selection.isPicked(id)} /> : null}
              {id}
            </button>
          </li>
        ))}
      </ul>
      {selection.selecting ? (
        <SelectionBar label="Selected rows" count={selection.count} allPicked={selection.allPicked} onToggleAll={selection.toggleAll} onDone={selection.stop}>
          <button type="button" disabled={selection.count === 0} onClick={() => onRemove([...selection.picked])}>Remove</button>
        </SelectionBar>
      ) : null}
    </NextIntlClientProvider>
  );
}

it("enters select mode, ticks rows, selects all, clears and leaves", () => {
  const onRemove = vi.fn();
  render(<List ids={["a", "b", "c"]} onRemove={onRemove} />);
  expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
  const toggle = screen.getByRole("button", { name: "Select rows" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("None selected")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
  expect(screen.getByRole("checkbox", { name: "b" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("1 selected")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(["a", "b", "c"]);

  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByText("None selected")).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select rows" }));
  expect(screen.getByText("None selected")).toBeTruthy();
});

it("drops a ticked row that leaves the list, so a stale tick never reaches an action", () => {
  const onRemove = vi.fn();
  const { rerender } = render(<List ids={["a", "b"]} onRemove={onRemove} />);
  fireEvent.click(screen.getByRole("button", { name: "Select rows" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("2 selected")).toBeTruthy();
  rerender(<List ids={["b", "c"]} onRemove={onRemove} />);
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(onRemove).toHaveBeenCalledExactlyOnceWith(["b"]);
});

it("starts select mode with the held row ticked and swallows the tap that ends the hold", () => {
  vi.useFakeTimers();
  const onOpen = vi.fn();
  render(<List ids={["a", "b"]} onOpen={onOpen} />);
  const row = screen.getByRole("button", { name: "b" });
  fireEvent.pointerDown(row, { pointerType: "touch", clientX: 10, clientY: 10 });
  act(() => { vi.advanceTimersByTime(500); });
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  expect(onOpen).not.toHaveBeenCalled();
  expect(screen.getByText("1 selected")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "b" }).getAttribute("aria-checked")).toBe("true");
});

it("treats a short tap or a scroll as an ordinary gesture", () => {
  vi.useFakeTimers();
  const onOpen = vi.fn();
  render(<List ids={["a", "b"]} onOpen={onOpen} />);
  const row = screen.getByRole("button", { name: "a" });
  fireEvent.pointerDown(row, { pointerType: "touch", clientX: 10, clientY: 10 });
  act(() => { vi.advanceTimersByTime(200); });
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("a");

  fireEvent.pointerDown(row, { pointerType: "touch", clientX: 10, clientY: 10 });
  fireEvent.pointerMove(row, { pointerType: "touch", clientX: 10, clientY: 60 });
  act(() => { vi.advanceTimersByTime(800); });
  expect(screen.queryByRole("region", { name: "Selected rows" })).toBeNull();
});
