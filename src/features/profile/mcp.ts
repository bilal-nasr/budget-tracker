import "server-only";
import { defineTool } from "@/lib/mcp/tool";
import { getProfile } from "./queries";

/** Connector tools for the profile. Collected by `src/lib/mcp/registry.ts`. */
export const profileTools = [
  defineTool({
    name: "profile_get",
    title: "Get profile",
    description:
      "Read the person's Budget Tracker settings: app language (locale), digit style, theme, time zone, " +
      "whether onboarding is finished, the default currency, the last USD to LBP rate used (LBP per 1 USD), " +
      "whether the salary summary email is on, and the saved salary (amount in minor units and the balance it goes to), if any.",
    kind: "read",
    run: () => getProfile(),
  }),
];
