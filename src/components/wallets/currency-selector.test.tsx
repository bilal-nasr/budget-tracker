// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CurrencySelector } from "./currency-selector";
afterEach(cleanup);
it("exposes a labeled native currency selector in catalog order with disabled definitions hidden", () => {
  const onChange = vi.fn();
  render(<CurrencySelector label="Display currency" value="TOKEN" onChange={onChange} currencies={[
    { code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: false, firstUsed: false },
    { code: "JPY", symbol: "¥", decimalPlaces: 0, disabled: true, firstUsed: false },
    { code: "EUR", symbol: "€", decimalPlaces: 2, disabled: false, firstUsed: false },
  ]} />);
  const select = screen.getByRole("combobox", { name: "Display currency" });
  expect(select.getAttribute("dir")).toBe("ltr");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["TOKEN", "EUR"]);
  fireEvent.change(select, { target: { value: "EUR" } });
  expect(onChange).toHaveBeenCalledWith("EUR");
});
