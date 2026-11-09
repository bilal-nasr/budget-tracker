"use client";

import { useCallback, useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Tallest the field grows before it scrolls: about six lines of 16px text. */
const MAX_HEIGHT = 160;

/**
 * A single-value text field that wraps and grows with what is typed, so a long name is never
 * cut off. Same look as `TextField`: visible label, 48px minimum height, error linked with
 * aria-describedby. It holds one line of text: Enter does not add a line break (it calls
 * `onEnter`, or submits the form), and pasted line breaks become spaces.
 */
export function TextAreaField({
  label,
  error,
  description,
  className,
  onEnter,
  onChange,
  ref,
  ...props
}: {
  label: string;
  error?: string | null;
  description?: React.ReactNode;
  /** What Enter does; by default it submits the surrounding form. */
  onEnter?: () => void;
} & React.ComponentProps<"textarea">) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const describedBy = [props["aria-describedby"], error ? errorId : null, description ? descriptionId : null].filter(Boolean).join(" ") || undefined;
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const setRef = useCallback((node: HTMLTextAreaElement | null) => {
    inner.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  // Fit the height to the text after every change (and when the text is set from outside, e.g. cleared after adding).
  useLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight + node.offsetHeight - node.clientHeight, MAX_HEIGHT)}px`;
  }, [props.value]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        ref={setRef}
        rows={1}
        dir="auto"
        aria-invalid={error ? true : undefined}
        className="min-h-12 max-h-40 resize-none overflow-y-auto rounded-lg border border-input bg-card px-3.5 py-3 text-base leading-snug text-foreground outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-over"
        {...props}
        onChange={(event) => {
          const flat = event.target.value.replace(/\s*[\r\n]+\s*/g, " ");
          if (flat !== event.target.value) event.target.value = flat;
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (onEnter) onEnter();
          else event.currentTarget.form?.requestSubmit();
        }}
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
