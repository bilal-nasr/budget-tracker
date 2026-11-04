import type { Metadata, Viewport } from "next";
import { Readex_Pro } from "next/font/google";
import Script from "next/script";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ThemeSync } from "@/components/providers/theme-sync";
import { isRtl, routing } from "@/i18n/routing";
import "../globals.css";

// One family designed for Latin and Arabic together, so mixed lines match.
// `subsets` only picks what is preloaded: the Arabic face is still declared and
// loads when Arabic text renders, so English pages skip its 23 KB download.
const sans = Readex_Pro({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Applies the saved theme (or the system one) before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f4c4a" },
    { media: "(prefers-color-scheme: dark)", color: "#0e3f3d" },
  ],
};

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "App" });
  return { title: t("name"), description: t("tagline") };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      className={`${sans.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground">
        <Script id="theme-init" strategy="beforeInteractive">{themeScript}</Script>
        <NextIntlClientProvider>
          <ThemeSync />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
