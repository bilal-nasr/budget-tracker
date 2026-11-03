import { PageBody } from "@/components/shell/page-body";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown by each route's loading.tsx while its data loads. The shell and tab
 * bar stay mounted, so a tap highlights the new tab at once. Heights match the
 * real screens so content arrives without a jump.
 */
export function ScreenSkeleton({ variant }: { variant: "home" | "list" | "form" }) {
  return (
    <div aria-busy="true">
      <div className="bg-shell">
        <div className="mx-auto w-full max-w-[640px] px-4 pt-[calc(0.5rem+var(--safe-top))] lg:max-w-[800px]">
          <div className="min-h-[52px]" />
          <div className={variant === "home" ? "h-[88px]" : "h-3"} />
        </div>
      </div>
      <PageBody className={variant === "list" ? "gap-2" : undefined}>
        {variant === "home" ? (
          <>
            <Skeleton className="h-[152px] rounded-xl" />
            <Skeleton className="h-[220px] rounded-xl" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[60px] rounded-xl" />
              ))}
            </div>
          </>
        ) : variant === "list" ? (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[60px] rounded-xl" />)
        ) : (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)
        )}
      </PageBody>
    </div>
  );
}
