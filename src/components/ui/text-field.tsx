import { useId } from "react";
import { cn } from "@/lib/utils";

/** Visible label, 48px input, error linked with aria-describedby. */
export function TextField({
  label,
  error,
  className,
  ...props
}: { label: string; error?: string | null } & React.ComponentProps<"input">) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-12 rounded-lg border border-input bg-card px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over"
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-over">
          {error}
        </p>
      ) : null}
    </div>
  );
}
