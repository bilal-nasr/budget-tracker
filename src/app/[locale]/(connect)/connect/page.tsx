import { AppWindow, Eye, Globe, Lock, Pencil } from "lucide-react";
import { redirect as redirectAway } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthShell } from "@/components/shell/auth-shell";
import { lookUpAuthorization } from "@/features/connect/authorization";
import { getProfile } from "@/features/profile/queries";
import { Link, redirect } from "@/i18n/navigation";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { ConsentForm } from "./consent-form";

/**
 * The consent screen an assistant app's sign-in leads to (via /oauth/consent). Signed-out
 * visitors never reach it: the proxy remembers the authorization and sends them to sign in.
 * Like a share link, an account that has not finished setup is sent to onboarding first.
 */
export default async function ConnectPage({ params, searchParams }: PageProps<"/[locale]/connect">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (supabaseConfigured() && !(await getProfile()).onboarded) redirect({ href: "/onboarding", locale });

  const request = await lookUpAuthorization((await searchParams).authorization_id);
  if (request.kind === "redirect") redirectAway(request.url);

  const t = await getTranslations("connect");
  const app = await getTranslations("App");

  if (request.kind === "expired") {
    return (
      <AuthShell appName={app("name")} title={t("expiredTitle")} body={t("expiredBody")}>
        <div className="flex flex-col">
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t("backHome")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  const lead = request.email
    ? t.rich("signedInAs", {
        email: request.email,
        bdi: (chunks) => <bdi dir="ltr" className="font-medium text-shell-foreground">{chunks}</bdi>,
      })
    : null;

  return (
    <AuthShell appName={app("name")} title={t("title")} body={lead}>
      <div className="flex flex-col">
        <dl className="rounded-xl border border-border bg-card">
          <div className="flex min-h-[68px] items-center gap-3 px-3.5 py-3">
            <span aria-hidden className="grid size-10 flex-none place-items-center rounded-md bg-secondary text-primary">
              <AppWindow className="size-5" strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-col">
              <dt className="text-[13px] leading-[1.4] text-muted-foreground">{t("appName")}</dt>
              {/* Whatever the app calls itself: plain text, isolated, clamped if it is very long. */}
              <dd className="line-clamp-2 text-[17px] leading-[1.4] font-semibold [overflow-wrap:anywhere]">
                <bdi>{request.name || "—"}</bdi>
              </dd>
            </div>
          </div>
          <div className="flex min-h-[68px] items-center gap-3 border-t border-border px-3.5 py-3">
            <span aria-hidden className="grid size-10 flex-none place-items-center rounded-md bg-secondary text-primary">
              <Globe className="size-5" strokeWidth={1.75} />
            </span>
            <div className="flex min-w-0 flex-col">
              <dt className="text-[13px] leading-[1.4] text-muted-foreground">{t("sendsTo")}</dt>
              <dd className="text-[17px] leading-[1.4] font-semibold [overflow-wrap:anywhere]">
                <bdi dir="ltr" className="tabular-nums">{request.host}</bdi>
              </dd>
            </div>
          </div>
        </dl>

        <h2 className="mt-6 mb-2 text-[15px] leading-normal font-semibold">{t("intro")}</h2>
        <ul className="flex flex-col gap-2.5 text-[15px] leading-normal">
          <li className="flex items-start gap-3">
            <Eye aria-hidden className="mt-px size-5 flex-none text-primary" strokeWidth={1.75} />
            <span>{t("canRead")}</span>
          </li>
          <li className="flex items-start gap-3">
            <Pencil aria-hidden className="mt-px size-5 flex-none text-primary" strokeWidth={1.75} />
            <span>{t("canChange")}</span>
          </li>
        </ul>
        <p className="mt-3.5 flex items-start gap-3 border-t border-border pt-3.5 text-[15px] leading-normal text-muted-foreground">
          <Lock aria-hidden className="mt-px size-5 flex-none" strokeWidth={1.75} />
          <span>{t("cannotSeePassword")}</span>
        </p>

        <ConsentForm authorizationId={request.id} />
        <p className="mt-4 text-center text-[13px] leading-[1.4] text-muted-foreground">{t("removeLater")}</p>
      </div>
    </AuthShell>
  );
}
