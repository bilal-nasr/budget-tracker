// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Amount } from "./amount";
import { AppDataProvider } from "@/components/providers/app-data";
afterEach(cleanup);
it("resolves runtime custom precision and symbol through the complete catalog", () => {
 const { container } = render(<AppDataProvider walletContainers={[]} currencies={[{ code: "TOKEN", symbol: "◈", decimalPlaces: 8, disabled: true, firstUsed: true }]} categories={[]} timezone="UTC" salary={null} usdLbpRate={null}><Amount currency="TOKEN" minor={123456789} /></AppDataProvider>);
 expect(container.textContent).toBe("◈1.23456789");
 expect(container.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
});
