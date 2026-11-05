import { expect, it } from "vitest";
import { readAllByKey } from "./read-all";

const first = Array.from({ length: 500 }, (_, n) => ({ id: String(n).padStart(5, "0") }));
it("rejects a later page failure instead of returning the first page as complete", async () => {
  await expect(readAllByKey(async (after) => after === null ? { data: first, error: null } : { data: null, error: { message: "private detail" } }, (row) => row.id, "Unavailable"))
    .rejects.toThrow("Unavailable");
});
it("rejects a repeated boundary or an unordered page rather than skipping history", async () => {
  await expect(readAllByKey(async (after) => ({ data: after === null ? first : [{ id: "00499" }], error: null }), (row) => row.id, "Unavailable"))
    .rejects.toThrow("Unavailable");
  await expect(readAllByKey(async () => ({ data: [{ id: "b" }, { id: "a" }], error: null }), (row) => row.id, "Unavailable"))
    .rejects.toThrow("Unavailable");
});
