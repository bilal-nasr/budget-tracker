"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/shell/empty-state";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { joinFolder } from "@/features/invoices/actions";
import { invoiceErrorKey } from "@/features/invoices/errors";
import { MAX_PERSON_NAME, personNameSchema } from "@/features/invoices/schema";
import { Link, useRouter } from "@/i18n/navigation";

/**
 * Opening a share link asks first: the folder's name and a name for yourself, then Join.
 * Nothing changes until Join is pressed. A link that does not work, for any reason, shows
 * one message, so the page never reveals whether a folder exists.
 */
export function JoinView({ token, folderName }: { token: string; folderName: string | null }) {
  const t = useTranslations("Invoices");
  const router = useRouter();
  const [name, setName] = useState("");
  const [dead, setDead] = useState(folderName === null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [pending, startTransition] = useTransition();
  // Set synchronously, so a double tap (or Enter during a tap) cannot join twice.
  const busy = useRef(false);
  const valid = personNameSchema.safeParse(name).success;

  const join = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = personNameSchema.safeParse(name);
    if (!parsed.success || busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      const result = await joinFolder(token, parsed.data).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (result.ok) {
        setJoined(true);
        router.replace(`/invoices/${result.folderId}`);
        return;
      }
      busy.current = false;
      if (result.error === "linkInvalid") setDead(true);
      else setError(t(invoiceErrorKey(result.error)));
    });
  };

  return <>
    <ScreenHeader title={t("joinTitle")}>
      {dead ? null : <>
        <p className="text-[15px] text-shell-muted">{t("joinLead")}</p>
        <p className="mt-1 text-[28px] leading-tight font-bold tracking-[-0.025em] break-words text-shell-foreground"><bdi>{folderName}</bdi></p>
      </>}
    </ScreenHeader>
    <PageBody>
      {dead ? (
        <EmptyState
          title={t("errorLink")}
          action={<Link href="/" className={buttonVariants({ variant: "outline" })}>{t("joinHome")}</Link>}
        />
      ) : (
        <form onSubmit={join} noValidate className="flex flex-col gap-5">
          <p className="text-[15px] text-muted-foreground">{t("joinHelp")}</p>
          <TextField
            label={t("joinName")}
            description={t("joinNameHelp")}
            placeholder={t("joinNamePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_PERSON_NAME}
            autoComplete="nickname"
            enterKeyHint="go"
            disabled={joined}
          />
          <div className="flex flex-col gap-2">
            <Button type="submit" size="lg" className="w-full" disabled={!valid} loading={pending || joined}>{t("join")}</Button>
            {error ? <p role="alert" className="text-sm text-over">{error}</p> : null}
          </div>
        </form>
      )}
    </PageBody>
  </>;
}
