import { TileBand } from "@/components/tiles/tile-band";

/** Teal header with a title and a narrow form column, shared by sign-in, sign-up and check-email. */
export function AuthShell({
  appName,
  title,
  body,
  children,
}: {
  appName: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="bg-shell text-shell-foreground">
        <div className="mx-auto max-w-[440px] px-4 pt-[calc(2.5rem+var(--safe-top))] pb-8">
          <p className="text-[15px] text-shell-muted">{appName}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-[15px] text-shell-muted">{body}</p>
        </div>
        <TileBand />
      </header>
      <main className="mx-auto max-w-[440px] px-4 py-8 pb-[calc(2rem+var(--safe-bottom))]">{children}</main>
    </div>
  );
}
