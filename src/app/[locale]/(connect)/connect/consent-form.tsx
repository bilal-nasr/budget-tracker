"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { decideAuthorization } from "@/features/connect/actions";
import { useRouter } from "@/i18n/navigation";

type Decision = "approve" | "deny";

/**
 * Allow and Deny. Either answer goes to Supabase Auth, and the browser then goes to the
 * address Supabase returns (the app that asked), never anywhere taken from this page's URL.
 */
export function ConsentForm({ authorizationId }: { authorizationId: string }) {
  const t = useTranslations("connect");
  const router = useRouter();
  const [pending, setPending] = useState<Decision | null>(null);
  // An app with its own scheme opens outside the browser and leaves this page in place: keep it answered.
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  const decide = async (decision: Decision) => {
    if (pending || sent) return;
    setPending(decision);
    setFailed(false);
    const result = await decideAuthorization(authorizationId, decision).catch(() => ({ ok: false as const, error: "failed" as const }));
    if (result.ok) {
      setSent(true);
      setPending(null);
      window.location.assign(result.redirectUrl);
      return;
    }
    setPending(null);
    setFailed(true);
    // A request Supabase no longer knows: show the page's "link no longer works" state.
    if (result.error === "expired") router.refresh();
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      {failed ? (
        <p role="alert" className="rounded-lg bg-over-soft px-3.5 py-3 text-[15px] text-over-foreground">
          {t("failed")}
        </p>
      ) : null}
      <Button size="lg" className="w-full" loading={pending === "approve"} disabled={sent || pending !== null} onClick={() => decide("approve")}>
        {t("allow")}
      </Button>
      <Button size="lg" variant="outline" className="w-full" loading={pending === "deny"} disabled={sent || pending !== null} onClick={() => decide("deny")}>
        {t("deny")}
      </Button>
    </div>
  );
}
