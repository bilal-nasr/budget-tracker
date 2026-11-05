import { describe, expect, it } from "vitest";
import { applyWalletOrder, reconcileWalletOrder } from "./reorder";

const wallets = [{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }];

describe("global wallet order", () => {
  it.each([["a", "a", "c"], ["a", "b"], ["a", "b", "foreign"], ["a", "b", "c", "foreign"]])("rejects a non-permutation %j", (...ids) => {
    expect(applyWalletOrder(wallets, ids)).toBeNull();
  });
  it("applies an exact permutation with dense positions without mutating inputs", () => {
    expect(applyWalletOrder(wallets, ["c", "a", "b"])).toEqual([{ id: "c", position: 0 }, { id: "a", position: 1 }, { id: "b", position: 2 }]);
    expect(wallets).toEqual([{ id: "a", position: 0 }, { id: "b", position: 1 }, { id: "c", position: 2 }]);
  });
  it("orders canonical inputs by global position", () => {
    expect(reconcileWalletOrder([wallets[2], wallets[0], wallets[1]], null).map((wallet) => wallet.id)).toEqual(["a", "b", "c"]);
  });
  it("appends a newly created wallet after an existing reordered list", () => {
    expect(reconcileWalletOrder([...wallets, { id: "new", position: 3 }], ["c", "a", "b"]).map((wallet) => wallet.id)).toEqual(["c", "a", "b", "new"]);
  });
  it("compacts positions after deletion while keeping remaining relative order", () => {
    expect(reconcileWalletOrder([wallets[0], wallets[2]], ["c", "b", "a"])).toEqual([{ id: "c", position: 0 }, { id: "a", position: 1 }]);
  });
});
