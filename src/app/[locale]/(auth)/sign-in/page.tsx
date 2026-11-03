import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { TileBand } from "@/components/tiles/tile-band";
import { SignInForm } from "./sign-in-form";

export default function SignInPage({ params }: PageProps<"/[locale]/sign-in">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("SignIn");
  const app = useTranslations("App");
  return (
    <div className="min-h-dvh">
      <header className="bg-shell text-shell-foreground">
        <div className="mx-auto max-w-[440px] px-4 pt-[calc(2.5rem+var(--safe-top))] pb-8">
          <p className="text-[15px] text-shell-muted">{app("name")}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-[15px] text-shell-muted">{t("body")}</p>
        </div>
        <TileBand />
      </header>
      <main className="mx-auto max-w-[440px] px-4 py-8 pb-[calc(2rem+var(--safe-bottom))]">
        <SignInForm />
      </main>
    </div>
  );
}
