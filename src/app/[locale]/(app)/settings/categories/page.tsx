import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoriesManager } from "@/components/categories/categories-manager";
import { PageBody } from "@/components/shell/page-body";
import { ScreenHeader } from "@/components/shell/screen-header";
import { getCategories } from "@/features/categories/queries";
import { Link } from "@/i18n/navigation";

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [categories, t] = await Promise.all([getCategories(), getTranslations("Categories")]);
  return <><ScreenHeader title={t("title")} /><PageBody className="lg:max-w-[640px]"><Link href="/settings" className="mb-4 inline-flex min-h-11 items-center rounded-lg text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{t("back")}</Link><CategoriesManager categories={categories} /></PageBody></>;
}
