import { useId } from "react";
import { cn } from "@/lib/utils";

/** Also apply to raw numeric inputs that do not need a TextField label wrapper. */
export const numericInputProps = {
  type: "text",
  dir: "ltr",
  autoComplete: "off",
  spellCheck: false,
  // Base UI protects mouse text selection by default; touch caret gestures opt out.
  "data-base-ui-swipe-ignore": "",
} as const;

export const numericInputClassName = "text-start tabular-nums select-text [unicode-bidi:isolate]";

/** Visible label, 48px input, error linked with aria-describedby. */
export function TextField({
  label,
  error,
  description,
  className,
  ...props
}: { label: string; error?: string | null; description?: React.ReactNode } & React.ComponentProps<"input">) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const describedBy = [props["aria-describedby"], error ? errorId : null, description ? descriptionId : null].filter(Boolean).join(" ") || undefined;
  const numeric = props.inputMode === "numeric" || props.inputMode === "decimal";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-12 rounded-lg border border-input bg-card px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over",
          numeric && numericInputClassName,
        )}
        {...props}
        {...(numeric ? numericInputProps : {})}
        aria-describedby={describedBy}
      />
      {description ? <p id={descriptionId} className="text-[13px] text-muted-foreground">{description}</p> : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-over">
          {error}
        </p>
      ) : null}
    </div>
  );
}
