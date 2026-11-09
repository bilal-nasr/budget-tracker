import { setRequestLocale } from "next-intl/server";
import { FolderView } from "@/components/invoices/folder-view";
import { getInvoiceFolder } from "@/features/invoices/queries";
import { redirect } from "@/i18n/navigation";

export default async function InvoiceFolderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // Not a member, removed, or no such folder all look the same. An open folder refetches this
  // page while it is on screen, so someone removed meanwhile lands on the list with a notice.
  const folder = await getInvoiceFolder(id);
  if (!folder) return redirect({ href: { pathname: "/invoices", query: { unavailable: "1" } }, locale });
  return <FolderView folder={folder} />;
}
