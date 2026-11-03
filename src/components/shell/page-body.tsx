import { cn } from "@/lib/utils";

/** Content column under a screen header: 640px on phones/tablets, 1120px on desktop. */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-6 lg:max-w-[800px]",
        className,
      )}
    >
      {children}
    </main>
  );
}
