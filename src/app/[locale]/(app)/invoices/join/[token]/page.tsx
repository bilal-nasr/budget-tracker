import { setRequestLocale } from "next-intl/server";
import { JoinView } from "@/components/invoices/join-view";
import { ownInvoiceFolderForLink, previewInvoiceLink } from "@/features/invoices/queries";
import { redirect } from "@/i18n/navigation";

/**
 * Opens a share link. Signed-out visitors never reach this page: the proxy remembers the
 * link and sends them to sign in first. Any token that does not work (including a malformed
 * one) gets the same generic message from the view, never an error page.
 */
export default async function JoinInvoicePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [ownFolder, preview] = await Promise.all([ownInvoiceFolderForLink(token), previewInvoiceLink(token)]);
  // The owner opening their own link has nothing to join.
  if (ownFolder) redirect({ href: `/invoices/${ownFolder}`, locale });
  return <JoinView key={token} token={token} folderName={preview?.name ?? null} />;
}
