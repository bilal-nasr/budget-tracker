import { setRequestLocale } from "next-intl/server";
import { FoldersView } from "@/components/invoices/folders-view";
import { getInvoiceFolders } from "@/features/invoices/queries";

export default async function InvoicesPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  // Set by the folder page when a folder is gone for the viewer.
  return <FoldersView folders={await getInvoiceFolders()} unavailable={query.unavailable === "1"} />;
}
