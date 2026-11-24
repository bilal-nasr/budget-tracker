import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { getConnectedApps, getConnectorSetup } from "@/features/connect/grants";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { ConnectedAppsView } from "./connected-apps-view";

/**
 * Settings > Connected apps. Reads on the server (the person's own session): the apps they
 * approved, the connector address, and the registered app id for the "Connect Claude" help.
 * Without a backend (the demo preview) there is nothing to read, so it shows the empty help.
 */
export async function ConnectedAppsSection() {
  const [apps, setup] = await Promise.all([
    supabaseConfigured() ? getConnectedApps() : Promise.resolve([]),
    getConnectorSetup(),
  ]);
  return <ConnectedAppsView apps={apps} address={setup.url} appIds={setup.clients} />;
}

/** The block's shape while it loads: the title, one app row, the folded help row. */
export async function ConnectedAppsSkeleton() {
  const t = await getTranslations("Settings.connectedApps");
  return (
    <section aria-labelledby="s-connected-apps-loading" className="flex flex-col gap-2">
      <h2 id="s-connected-apps-loading" className="text-[17px] font-semibold">{t("title")}</h2>
      <div aria-hidden className="flex min-h-[68px] items-center gap-3 rounded-xl border border-border bg-card ps-3.5 pe-4">
        <Skeleton className="size-10 flex-none" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div aria-hidden className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4">
        <Skeleton className="size-5 flex-none" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </section>
  );
}
