import { setRequestLocale } from "next-intl/server";
import { ItemsView } from "@/components/items/items-view";
import { getInvoiceFolderChoices } from "@/features/invoices/choices";
import { getShoppingItems } from "@/features/items/queries";

export default async function ItemsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [items, folders] = await Promise.all([getShoppingItems(), getInvoiceFolderChoices()]);
  return <ItemsView items={items} folders={folders} />;
}
