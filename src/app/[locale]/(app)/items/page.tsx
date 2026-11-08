import { setRequestLocale } from "next-intl/server";
import { ItemsView } from "@/components/items/items-view";
import { getShoppingItems } from "@/features/items/queries";

export default async function ItemsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ItemsView items={await getShoppingItems()} />;
}
