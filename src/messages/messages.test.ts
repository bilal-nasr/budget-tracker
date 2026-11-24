import { describe, expect, it } from "vitest";
import en from "./en.json";
import ar from "./ar.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("message catalogs", () => {
  it("have identical keys in English and Arabic", () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it("keeps the English and Arabic Settings message trees in sync", () => {
    expect(keys(ar.Settings).sort()).toEqual(keys(en.Settings).sort());
  });

  it("the consent screen points to Settings, and promises no changes, now that Connected apps exists", () => {
    for (const catalog of [en, ar]) {
      expect(Object.keys(catalog.connect)).toContain("removeLater");
      expect(Object.keys(catalog.connect)).not.toContain("canChange");
    }
  });
});
