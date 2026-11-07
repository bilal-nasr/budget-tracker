import { describe, expect, it } from "vitest";
import { deviceLabel, passkeyErrorKind } from "./errors";

describe("passkeyErrorKind", () => {
  it("treats a dismissed prompt as cancelled", () => {
    expect(passkeyErrorKind({ name: "NotAllowedError", code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" })).toBe("cancelled");
    expect(passkeyErrorKind({ name: "Unknown Error", cause: { name: "AbortError" } })).toBe("cancelled");
    expect(passkeyErrorKind({ code: "ERROR_CEREMONY_ABORTED" })).toBe("cancelled");
  });

  it("recognises a key that is already on this device", () => {
    expect(passkeyErrorKind({ name: "InvalidStateError", code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe("duplicate");
  });

  it("recognises a site address that does not match the server setup", () => {
    expect(passkeyErrorKind({ code: "ERROR_INVALID_RP_ID" })).toBe("domain");
    expect(passkeyErrorKind({ code: "ERROR_INVALID_DOMAIN" })).toBe("domain");
  });

  it("recognises unsupported browsers and failed bot checks", () => {
    expect(passkeyErrorKind({ message: "Browser does not support WebAuthn" })).toBe("unsupported");
    expect(passkeyErrorKind({ code: "captcha_failed", message: "captcha verification process failed" })).toBe("captcha");
  });

  it("falls back to failed for anything else, including non-errors", () => {
    expect(passkeyErrorKind({ code: "unexpected_failure", message: "boom" })).toBe("failed");
    expect(passkeyErrorKind(null)).toBe("failed");
    expect(passkeyErrorKind("nope")).toBe("failed");
  });
});

describe("deviceLabel", () => {
  it("names the device from the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130")).toBe("Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130")).toBe("Windows");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605")).toBe("Mac");
    expect(deviceLabel("")).toBe("Device");
  });
});
