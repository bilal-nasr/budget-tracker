import { describe, expect, it } from "vitest";
import { buildCycles, cycleDays, neighbours, pickCycle } from "./cycles";

describe("pay cycles", () => {
  const cycles = buildCycles(["2026-10-29", "2026-09-27", "2026-11-26", "2026-11-26"]);
  it("runs from one salary date to the next, newest first", () => {
    expect(cycles).toEqual([
      { from: "2026-11-26", to: null },
      { from: "2026-10-29", to: "2026-11-26" },
      { from: "2026-09-27", to: "2026-10-29" },
    ]);
  });
  it("picks the requested cycle or the newest", () => {
    expect(pickCycle(cycles, "2026-10-29")?.to).toBe("2026-11-26");
    expect(pickCycle(cycles, "nope")?.from).toBe("2026-11-26");
    expect(pickCycle([], null)).toBeNull();
  });
  it("finds neighbours and inclusive day ranges", () => {
    expect(neighbours(cycles, cycles[1])).toEqual({ older: "2026-09-27", newer: "2026-11-26" });
    expect(cycleDays(cycles[1], "2026-12-01")).toEqual({ from: "2026-10-29", to: "2026-11-25" });
    expect(cycleDays(cycles[0], "2026-12-01")).toEqual({ from: "2026-11-26", to: "2026-12-01" });
  });
});
