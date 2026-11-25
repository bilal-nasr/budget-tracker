import "server-only";
import { z } from "zod";
import { getCurrencies } from "@/features/currencies/queries";
import { currencyCodeSchema } from "@/features/currencies/schema";
import { defineTool, ToolError } from "@/lib/mcp/tool";
import { ACTION_ERROR_TEXT, unwrap } from "@/lib/mcp/write";
import { saveLocale, setDefaultCurrency, setSalaryEmail, updateProfile } from "./actions";
import { getProfile } from "./queries";
import { profileSchema } from "./schema";

const fields = profileSchema.shape;

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
  defineTool({
    name: "profile_update",
    title: "Update profile",
    description:
      "Change the person's settings. Send at least one field; fields you leave out stay as they are. " +
      "defaultCurrency is the currency the home screen opens on (an enabled code from currencies_list); locale is the app language; theme and digits are display preferences; " +
      "salaryEmail turns the wallet summary email sent when salary is marked received on or off. " +
      "The USD to LBP rate and the salary cannot be set here (the rate is remembered from exchanges; use salary_update for the salary). " +
      "Each setting is saved on its own, in the order listed; if one is refused the ones before it stay saved. Returns the profile in the shape profile_get gives.",
    kind: "write",
    input: z.strictObject({
      defaultCurrency: currencyCodeSchema.optional().describe("Currency code from currencies_list that the home screen opens on, for example USD. It must be enabled."),
      locale: fields.locale.optional().describe("App language: \"en\" (English) or \"ar\" (Arabic)."),
      theme: fields.theme.optional().describe("\"system\", \"light\" or \"dark\"."),
      digits: fields.digits.optional().describe("Digit style for numbers in the app: \"latin\" (0-9) or \"arabic\" (Arabic-Indic digits)."),
      salaryEmail: z.boolean().optional().describe("true sends the wallet summary email when salary is marked received; false stops it."),
    }).refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Send at least one field." }),
    run: async ({ defaultCurrency, locale, theme, digits, salaryEmail }) => {
      if (defaultCurrency !== undefined) {
        // The profile's foreign key only knows the catalog; the app offers enabled currencies only.
        const definition = (await getCurrencies()).find((currency) => currency.code === defaultCurrency);
        if (!definition) throw new ToolError(ACTION_ERROR_TEXT.currencyUnavailable);
        if (definition.disabled) throw new ToolError(ACTION_ERROR_TEXT.currencyDisabled);
        unwrap(await setDefaultCurrency(defaultCurrency));
      }
      if (locale !== undefined) unwrap(await saveLocale(locale));
      if (theme !== undefined || digits !== undefined) {
        unwrap(await updateProfile({ ...(theme !== undefined ? { theme } : {}), ...(digits !== undefined ? { digits } : {}) }));
      }
      if (salaryEmail !== undefined) unwrap(await setSalaryEmail(salaryEmail));
      return getProfile();
    },
  }),
];
