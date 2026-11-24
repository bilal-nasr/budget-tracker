import { describe, expect, it } from "vitest";
import { clientName, redirectHost, usableRedirect } from "./redirect";

describe("usableRedirect", () => {
  it("accepts web and app-scheme callbacks", () => {
    expect(usableRedirect("https://claude.ai/api/mcp/auth_callback?code=x&state=y")).toBe("https://claude.ai/api/mcp/auth_callback?code=x&state=y");
    expect(usableRedirect("http://localhost:6274/oauth/callback?code=x")).toBe("http://localhost:6274/oauth/callback?code=x");
    expect(usableRedirect("cursor://anysphere.cursor-retrieval/oauth/callback?code=x")).toBe("cursor://anysphere.cursor-retrieval/oauth/callback?code=x");
  });

  it.each(["", "not a url", "/relative", "javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "blob:https://x/y", undefined, null, 7])(
    "refuses %s",
    (value) => expect(usableRedirect(value)).toBeNull(),
  );
});

describe("redirectHost", () => {
  it("is the host (with port) the approval goes to", () => {
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHost("http://localhost:6274/oauth/callback")).toBe("localhost:6274");
    expect(redirectHost("https://user:pass@evil.example/cb")).toBe("evil.example");
  });

  it.each(["", "not a url", "javascript:alert(1)", "com.example.app:/callback", undefined])("has none for %s", (value) => {
    expect(redirectHost(value)).toBeNull();
  });
});

describe("clientName", () => {
  it("keeps the name as given, trimmed", () => {
    expect(clientName("  Claude  ")).toBe("Claude");
    expect(clientName("<b>Claude</b>")).toBe("<b>Claude</b>");
    expect(clientName("مساعد")).toBe("مساعد");
  });

  it("removes direction overrides and control characters a name could use to disguise itself", () => {
    expect(clientName("Cla‮ude‬")).toBe("Claude");
    expect(clientName("a⁦b⁩c‏d\u0000e\n")).toBe("abcde");
  });

  it("is empty for anything that is not a string", () => {
    expect(clientName(undefined)).toBe("");
    expect(clientName(42)).toBe("");
  });
});
