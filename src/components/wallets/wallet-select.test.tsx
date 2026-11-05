// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WalletSelect } from "./wallet-select";
afterEach(cleanup);
it("selects a canonical wallet by container identity without appending an undefined currency", () => {
 render(<WalletSelect wallets={[{ id: "pocket", name: "Pocket" }]} value="pocket" onChange={vi.fn()} label="Wallet" placeholder="Choose" />);
 const control = screen.getByRole("combobox");
 expect(control.textContent?.trim()).toBe("Pocket");
 expect(control.getAttribute("title")).toBe("Pocket");
});
