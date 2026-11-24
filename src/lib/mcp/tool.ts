import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { formatAmount, type CurrencyDefinition } from "@/lib/money";

/** read: changes nothing. write: changes data, undoable or additive. destructive: deletes, voids, cancels. */
export type ToolKind = "read" | "write" | "destructive";

/** One connector tool: what Claude sees (name, title, description, input) and what it runs. */
export type ToolDef = {
  /** `<area>_<verb>`, snake_case, English. */
  name: string;
  title: string;
  /** English, read by the model. */
  description: string;
  /** Arguments schema. The SDK validates against it before `run` is called. */
  input?: z.ZodObject;
  kind: ToolKind;
  // The registry holds tools of many input shapes; defineTool keeps each one typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any) => Promise<unknown>;
};

/** Declares a tool with `run`'s arguments typed from its input schema. */
export function defineTool<S extends z.ZodObject>(
  def: Omit<ToolDef, "input" | "run"> & { input?: S; run: (args: z.infer<S>) => Promise<unknown> },
): ToolDef {
  return def;
}

/** MCP hints so a client asks before changing or deleting anything. */
export function toolAnnotations(kind: ToolKind): ToolAnnotations {
  switch (kind) {
    case "read":
      return { readOnlyHint: true };
    case "write":
      return { readOnlyHint: false, destructiveHint: false };
    case "destructive":
      return { readOnlyHint: false, destructiveHint: true };
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type ToolResult = {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
};

/**
 * A tool's return value as an MCP result. Objects become structured content; arrays
 * are wrapped as `{ items }` (structured content must be an object). The text block
 * is the JSON of the same value, for clients that read text only.
 */
export function toResult(value: unknown): ToolResult {
  const structured = Array.isArray(value) ? { items: value } : isPlainObject(value) ? value : undefined;
  const text = JSON.stringify(structured ?? value ?? null);
  return structured ? { content: [{ type: "text", text }], structuredContent: structured } : { content: [{ type: "text", text }] };
}

/** An amount for Claude: the exact integer minor units plus an English, Latin-digit display text. */
export function moneyOut(minor: number, currency: CurrencyDefinition): { minor: number; currency: string; text: string } {
  return { minor, currency: currency.code, text: formatAmount(minor, currency, { digits: "latin" }) };
}

/** The only text a failing tool returns; the real error never reaches the client. */
export const TOOL_FAILED_TEXT = "Something went wrong. Try again.";

/**
 * A tool's expected, safe-to-show failure (for example "Folder not found."). The message must be a
 * fixed English sentence written in the tool code, never database or library text; any other
 * throw reaches the client only as TOOL_FAILED_TEXT.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
