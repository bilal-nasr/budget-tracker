import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Suspense, use } from "react";
import { AuthShell } from "@/components/shell/auth-shell";
import { SignInForm } from "./sign-in-form";

export default function SignInPage({ params }: PageProps<"/[locale]/sign-in">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("SignIn");
  const app = useTranslations("App");
  return (
    <AuthShell appName={app("name")} title={t("title")} body={t("body")}>
      {/* The form reads ?error= from the URL, which needs a Suspense boundary on a prerendered page. */}
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthShell>
  );
}
