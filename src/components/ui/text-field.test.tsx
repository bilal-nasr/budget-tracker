// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TextField } from "./text-field";

afterEach(cleanup);

function DraftField({ initial = "١٢٣٤", mode = "numeric" }: {
  initial?: string;
  mode?: "numeric" | "decimal";
}) {
  const [draft, setDraft] = useState(initial);
  return <div dir="rtl"><TextField label="المبلغ" inputMode={mode} value={draft}
    onChange={(event) => setDraft(event.currentTarget.value)} /></div>;
}

describe("numeric TextField native editing contract", () => {
  it.each(["numeric", "decimal"] as const)("isolates the actual %s editor and yields Drawer swipes to its caret", (inputMode) => {
    const { getByLabelText } = render(<TextField label="المبلغ" inputMode={inputMode} defaultValue="1234" />);
    const input = getByLabelText("المبلغ") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.dir).toBe("ltr");
    expect(input.getAttribute("data-base-ui-swipe-ignore")).toBe("");
    expect(input.classList.contains("select-text")).toBe(true);
    expect(input.classList.contains("[unicode-bidi:isolate]")).toBe(true);
    expect(input.classList.contains("text-start")).toBe(true);
  });

  it("leaves nonnumeric field direction, text and caller events alone", () => {
    const onFocus = vi.fn();
    const { getByLabelText } = render(<TextField label="Name" dir="rtl" defaultValue="متجر 12" onFocus={onFocus} />);
    const input = getByLabelText("Name") as HTMLInputElement;
    input.focus();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(input.dir).toBe("rtl");
    expect(input.hasAttribute("data-base-ui-swipe-ignore")).toBe(false);
    expect(input.value).toBe("متجر 12");
  });

  it("does not move a touch-placed caret or select all on focus/re-render", () => {
    const { getByLabelText, rerender } = render(<DraftField />);
    const input = getByLabelText("المبلغ") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.pointerUp(input, { pointerType: "touch" });
    rerender(<DraftField />);
    expect(getByLabelText("المبلغ")).toBe(input);
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
    expect(input.value).toBe("١٢٣٤");
  });

  it.each(["", ".", "٫", "0.", "٠٫", "12.", "١٢٫", "٠١٢٫٥٠", "1٢.۵0", "1x2"])(
    "retains the raw editable string %j", (draft) => {
      const { getByLabelText } = render(<DraftField mode="decimal" />);
      const input = getByLabelText("المبلغ") as HTMLInputElement;
      fireEvent.change(input, { target: { value: draft } });
      expect(input.value).toBe(draft);
    },
  );

  it.each([
    ["deleteContentBackward", "١٣٤", 1],
    ["deleteContentForward", "١٢٤", 2],
    ["insertFromPaste", "١9٤", 2],
    ["deleteByCut", "١٤", 1],
  ] as const)("accepts the browser's %s result and caret without interception", (inputType, value, caret) => {
    const { getByLabelText } = render(<DraftField />);
    const input = getByLabelText("المبلغ") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 3);
    const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType });
    expect(input.dispatchEvent(before)).toBe(true);
    fireEvent.input(input, { inputType, target: { value, selectionStart: caret, selectionEnd: caret } });
    expect(input.value).toBe(value);
    expect(input.selectionStart).toBe(caret);
    expect(input.selectionEnd).toBe(caret);
  });

  it("preserves composition text and allows deletion to empty then retyping", () => {
    const { getByLabelText } = render(<DraftField />);
    const input = getByLabelText("المبلغ") as HTMLInputElement;
    fireEvent.compositionStart(input);
    fireEvent.input(input, { isComposing: true, inputType: "insertCompositionText", target: { value: "١٢٫" } });
    expect(input.value).toBe("١٢٫");
    fireEvent.compositionEnd(input, { data: "١٢٫" });
    for (const value of ["١٢", "١", "", "۵"]) {
      fireEvent.input(input, { target: { value } });
      expect(input.value).toBe(value);
    }
  });

  it("keeps labels and error associations on the input", () => {
    const { getByLabelText, getByRole } = render(<TextField label="Due day" inputMode="numeric" error="Use 1–31" />);
    const input = getByLabelText("Due day");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(getByRole("alert").id);
  });
});
