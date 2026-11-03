import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Suspense, use } from "react";
import { AuthShell } from "@/components/shell/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage({ params }: PageProps<"/[locale]/forgot-password">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("ForgotPassword");
  const app = useTranslations("App");
  return (
    <AuthShell appName={app("name")} title={t("title")} body={t("body")}>
      {/* The form reads ?error= from the URL, which needs a Suspense boundary on a prerendered page. */}
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
