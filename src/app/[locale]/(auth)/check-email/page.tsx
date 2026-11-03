import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AuthShell } from "@/components/shell/auth-shell";
import { Link } from "@/i18n/navigation";

export default function CheckEmailPage({ params }: PageProps<"/[locale]/check-email">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("CheckEmail");
  const app = useTranslations("App");
  return (
    <AuthShell appName={app("name")} title={t("title")} body={t("body")}>
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-muted-foreground">{t("help")}</p>
        <Link
          href="/sign-in"
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium"
        >
          {t("toSignIn")}
        </Link>
      </div>
    </AuthShell>
  );
}
