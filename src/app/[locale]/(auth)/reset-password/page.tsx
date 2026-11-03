import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AuthShell } from "@/components/shell/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage({ params }: PageProps<"/[locale]/reset-password">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("ResetPassword");
  const app = useTranslations("App");
  return (
    <AuthShell appName={app("name")} title={t("title")} body={t("body")}>
      <ResetPasswordForm />
    </AuthShell>
  );
}
