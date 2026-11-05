import { z } from "zod";

export const profileSchema = z.object({
  locale: z.enum(["en", "ar"]),
  digits: z.enum(["latin", "arabic"]),
  theme: z.enum(["system", "light", "dark"]),
  timezone: z.string().min(1),
  onboarded: z.boolean(),
  /** Currency the home screen opens on, or null for the first enabled one. */
  defaultCurrency: z.string().nullable().optional(),
  /** Last USD to LBP rate used (LBP per 1 USD), or null. */
  usdLbpRate: z.number().int().min(1).max(10_000_000).nullable(),
  salary: z
    .object({ amountMinor: z.number().int().positive(), balanceId: z.uuid() })
    .nullable(),
});

export type Profile = z.infer<typeof profileSchema>;

export const profilePatchSchema = profileSchema
  .pick({ locale: true, digits: true, theme: true })
  .partial();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** Used when Supabase is not configured (fresh checkout) so the UI still renders. */
export const DEFAULT_PROFILE: Profile = {
  locale: "en",
  digits: "latin",
  theme: "system",
  timezone: "Asia/Beirut",
  onboarded: true,
  usdLbpRate: null,
  defaultCurrency: null,
  salary: null,
};
