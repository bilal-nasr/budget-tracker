"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionError, ActionResult } from "@/lib/supabase/action";

/** Preserve one financial request until its outcome is known, independently of refreshed eligibility. */
export function useLoanSubmission<P extends object, R extends object>(run: (payload: P) => Promise<ActionResult<R>>, onSuccess: (result: { ok: true } & R) => void) {
  const retained = useRef<P | null>(null);
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<"idle" | "pending" | "uncertain" | "review">("idle");
  const [error, setError] = useState<ActionError | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (phase !== "pending" && phase !== "uncertain") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);
  const submit = (candidate: P | null) => {
    if (inFlight.current || phase === "review") return;
    const payload = retained.current ?? candidate;
    if (!payload) return;
    retained.current = payload;
    inFlight.current = true;
    setPhase("pending"); setError(null);
    startTransition(async () => {
      let result: ActionResult<R>;
      try { result = await run(payload); }
      catch { setError("failed"); setPhase("uncertain"); return; }
      finally { inFlight.current = false; }
      if (!result.ok) {
        setError(result.error);
        if (result.error === "failed") { setPhase("uncertain"); return; }
        if (["conflict", "loanClosed", "paymentOrder", "termsLocked"].includes(result.error)) { setPhase("review"); return; }
        retained.current = null;
        setPhase("idle"); return;
      }
      retained.current = null;
      setPhase("idle");
      onSuccess(result);
    });
  };
  return { submit, error, pending: phase === "pending", uncertain: phase === "uncertain", review: phase === "review",
    frozen: phase !== "idle", dismissible: phase === "idle" || phase === "review" };
}
