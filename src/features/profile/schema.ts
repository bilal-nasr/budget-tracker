import { z } from "zod";

export const profileSchema = z.object({
  locale: z.enum(["en", "ar"]),
  digits: z.enum(["latin", "arabic"]),
  theme: z.enum(["system", "light", "dark"]),
  timezone: z.string().min(1),
  onboarded: z.boolean(),
  salary: z
    .object({ amountMinor: z.number().int().positive(), walletId: z.uuid() })
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
  salary: null,
};
