import { expect, it } from "vitest";
import { routing } from "./routing";

it("persists the language preference across browser sessions throughout the app", () => {
  expect(routing.localeCookie).toMatchObject({
    name: "NEXT_LOCALE",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
});
