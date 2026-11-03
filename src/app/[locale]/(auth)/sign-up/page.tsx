import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { AuthShell } from "@/components/shell/auth-shell";
import { SignUpForm } from "./sign-up-form";

export default function SignUpPage({ params }: PageProps<"/[locale]/sign-up">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("SignUp");
  const app = useTranslations("App");
  return (
    <AuthShell appName={app("name")} title={t("title")} body={t("body")}>
      <SignUpForm />
    </AuthShell>
  );
}
