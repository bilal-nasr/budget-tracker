"use client";

import { useEffect, useState, useTransition } from "react";
import { loadLoanHistory } from "@/features/loans/history-actions";
import type { LoanHistoryPage } from "@/features/loans/queries";
import type { Loan } from "@/features/loans/schema";

export function useLoanHistory(item: Loan) {
  const [page, setPage] = useState<LoanHistoryPage | null>(() => item.historyComplete === false ? null : { rows: item.events, next: null });
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (item.historyComplete !== false) return;
    let active = true;
    loadLoanHistory(item.id, null).then((result) => { if (active) setPage(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [item.id, item.historyComplete]);
  const loadMore = () => startTransition(async () => {
    setFailed(false);
    try {
      const result = await loadLoanHistory(item.id, page?.next ?? null);
      setPage((previous) => ({ rows: [...(previous?.rows ?? []), ...result.rows], next: result.next }));
    } catch { setFailed(true); }
  });
  return { page, failed, pending, loadMore };
}
