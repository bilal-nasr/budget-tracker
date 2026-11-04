// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExpenseBreakdownFields, type ExpenseBreakdownLabels } from "./expense-breakdown-fields";
import { ExpenseBreakdown } from "@/components/transactions/expense-breakdown";
import { parseExpenseItemDrafts, type ExpenseItemDraft } from "@/features/transactions/breakdown";

afterEach(cleanup);

const labels: ExpenseBreakdownLabels = {
  title: "Breakdown", description: "Description", amount: "Amount", addItem: "Add item",
  removeItem: (index) => `Remove item ${index}`, itemCount: (count) => `${count} items`,
  itemizedTotal: "Itemized", remainder: "Not itemized", fullyItemized: "Fully itemized",
  exceedsTotal: "Items exceed the expense total", invalidItem: "Complete every item",
  invalidDescription: "Enter an item description", invalidAmount: "Enter a valid amount",
  maxItems: "You can add up to 50 items",
};
const initial: ExpenseItemDraft[] = [{ key: "one", description: "Phone credits", amountText: "20" }];

function Harness({ parentMinor = 5000, rows = [] }: { parentMinor?: number; rows?: ExpenseItemDraft[] }) {
  const [items, setItems] = useState(rows);
  return <>
    <ExpenseBreakdownFields currency="USD" parentMinor={parentMinor} items={items} onChange={setItems} labels={labels} />
    <button disabled={!parseExpenseItemDrafts("USD", parentMinor, items).valid}>Save</button>
  </>;
}

describe("ExpenseBreakdownFields", () => {
  it("is optional and collapsed by default, then focuses a new description", () => {
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: "Breakdown" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits and removes lines, retaining drafts through collapse and returning focus", () => {
    render(<Harness rows={initial} />);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "For sister" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50.01" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(labels.exceedsTotal);
    const toggle = screen.getByRole("button", { name: /Breakdown/ });
    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Description")).toBeNull();
    fireEvent.click(toggle);
    expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe("For sister");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
    expect(screen.getAllByText("Fully itemized").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove item 1" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add item" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("recomputes remainder and validity when parent cost changes", () => {
    const view = render(<Harness rows={initial} />);
    expect(screen.getAllByText("$30.00").length).toBeGreaterThan(0);
    view.rerender(<Harness rows={initial} parentMinor={1000} />);
    expect(screen.getByRole("alert").textContent).toContain(labels.exceedsTotal);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows field errors on blur, isolates amounts and enforces the row limit", () => {
    render(<Harness rows={[{ ...initial[0], description: "", amountText: "0" }]} />);
    fireEvent.blur(screen.getByLabelText("Description"));
    fireEvent.blur(screen.getByLabelText("Amount"));
    expect(screen.getByLabelText("Description").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Amount").getAttribute("dir")).toBe("ltr");
    cleanup();
    render(<Harness rows={Array.from({ length: 50 }, (_, i) => ({ ...initial[0], key: String(i), amountText: "0.01" }))} />);
    expect((screen.getByRole("button", { name: "Add item" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(labels.maxItems)).toBeTruthy();
  });
});

describe("ExpenseBreakdown", () => {
  it("keeps item descriptions and an explicit remainder without extra transaction amounts", () => {
    const { container } = render(<ExpenseBreakdown currency="USD" parentMinor={5000}
      items={[{ id: "line", position: 0, description: "رصيد Phone", amountMinor: 2000 }]} labels={labels} />);
    expect(screen.getByText("رصيد Phone").tagName).toBe("BDI");
    expect(screen.getByText("$20.00")).toBeTruthy();
    expect(screen.getByText("$30.00")).toBeTruthy();
    expect(container.querySelectorAll(".amount[dir=ltr]").length).toBeGreaterThan(0);
  });

  it("does not render an empty breakdown and shows full completion for equal sum", () => {
    const view = render(<ExpenseBreakdown currency="USD" parentMinor={5000} items={[]} labels={labels} />);
    expect(view.container.textContent).toBe("");
    view.rerender(<ExpenseBreakdown currency="USD" parentMinor={5000}
      items={[{ id: "line", position: 0, description: "For sister", amountMinor: 5000 }]} labels={labels} />);
    expect(screen.getByText(labels.fullyItemized)).toBeTruthy();
    expect(screen.queryByText(labels.remainder)).toBeNull();
  });
});
