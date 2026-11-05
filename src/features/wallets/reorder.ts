type OrderedWallet = { id: string; position: number };

export function applyWalletOrder<T extends OrderedWallet>(wallets: readonly T[], ids: readonly string[]): T[] | null {
  const byId = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  if (ids.length !== wallets.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return null;
  return ids.map((id, position) => ({ ...byId.get(id)!, position }));
}

/** Reconcile previews with canonical data: retain survivors, append additions, compact positions. */
export function reconcileWalletOrder<T extends OrderedWallet>(wallets: readonly T[], ids: readonly string[] | null): T[] {
  const sorted = [...wallets].sort((left, right) => left.position - right.position);
  const byId = new Map(sorted.map((wallet) => [wallet.id, wallet]));
  const ordered: T[] = [];
  for (const id of ids ?? []) {
    const wallet = byId.get(id);
    if (wallet) { ordered.push(wallet); byId.delete(id); }
  }
  return [...ordered, ...byId.values()].map((wallet, position) => ({ ...wallet, position }));
}
