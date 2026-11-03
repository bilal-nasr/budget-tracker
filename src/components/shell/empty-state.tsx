import { TileOrnament } from "@/components/tiles/tile-ornament";

/** One sentence of explanation and at most one primary action. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card px-6 py-10 text-center">
      <TileOrnament />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <p className="max-w-[36ch] text-[15px] text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}
