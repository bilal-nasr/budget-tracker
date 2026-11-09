import { describe, expect, it } from "vitest";
import { invoiceErrorKey } from "./errors";

describe("invoiceErrorKey", () => {
  it("maps action errors to Invoices message keys", () => {
    expect(invoiceErrorKey("notConfigured")).toBe("errorPreview");
    expect(invoiceErrorKey("invalid")).toBe("errorInvalid");
    expect(invoiceErrorKey("conflict")).toBe("errorConflict");
    expect(invoiceErrorKey("linkInvalid")).toBe("errorLink");
    expect(invoiceErrorKey("limitReached")).toBe("errorLimit");
    expect(invoiceErrorKey("currencyUnavailable")).toBe("errorCurrency");
    expect(invoiceErrorKey("currencyDisabled")).toBe("errorCurrency");
    expect(invoiceErrorKey("failed")).toBe("errorFailed");
    expect(invoiceErrorKey("walletDeleted")).toBe("errorFailed");
  });
});
