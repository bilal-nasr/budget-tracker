import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { KitchenSink } from "./kitchen-sink";

// Development reference page; never served in production.
export default async function KitchenSinkPage({
  params,
}: PageProps<"/[locale]/dev/kitchen-sink">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return <KitchenSink />;
}
