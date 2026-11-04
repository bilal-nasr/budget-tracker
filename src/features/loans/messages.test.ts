import { expect, it } from "vitest";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";
import { loanErrorKey } from "./errors";
it("ships every loan label and actionable lifecycle error in English and Arabic", () => {
  expect(Object.keys(en.Loans).sort()).toEqual(Object.keys(ar.Loans).sort());
  for (const catalog of [en.Loans, ar.Loans]) for (const value of Object.values(catalog)) expect(value.trim().length).toBeGreaterThan(0);
  expect(loanErrorKey("conflict")).toBe("errorConflict");
  expect(loanErrorKey("notConfigured")).toBe("errorPreview");
  expect(loanErrorKey("unknown SQL detail")).toBe("errorFailed");
});
