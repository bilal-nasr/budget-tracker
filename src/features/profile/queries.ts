import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { DEMO_SALARY } from "@/lib/demo-data";
import { DEFAULT_PROFILE, profileSchema, type Profile } from "./schema";

type ProfileRow = {
  locale: string;
  digits: string;
  theme: string;
  timezone: string;
  onboarded_at: string | null;
  salary_amount_minor?: number | string | null;
  salary_wallet_id?: string | null;
};

/** The signed-in owner's profile. Falls back to defaults when Supabase is not configured. */
export const getProfile = cache(async (): Promise<Profile> => {
  if (!supabaseConfigured()) return { ...DEFAULT_PROFILE, salary: DEMO_SALARY };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return DEFAULT_PROFILE;

  const primary = await supabase
    .from("profiles")
    .select("locale, digits, theme, timezone, onboarded_at, salary_amount_minor, salary_wallet_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  let data: ProfileRow | null = primary.data;
  if (primary.error) {
    // The salary columns come from a later migration; read the base columns if it is not applied yet.
    data = (
      await supabase
        .from("profiles")
        .select("locale, digits, theme, timezone, onboarded_at")
        .eq("user_id", auth.user.id)
        .maybeSingle()
    ).data;
  }
  if (!data) return { ...DEFAULT_PROFILE, onboarded: false };

  const parsed = profileSchema.safeParse({
    locale: data.locale,
    digits: data.digits,
    theme: data.theme,
    timezone: data.timezone,
    onboarded: data.onboarded_at !== null,
    salary:
      data.salary_amount_minor != null && data.salary_wallet_id != null
        ? { amountMinor: Number(data.salary_amount_minor), walletId: data.salary_wallet_id }
        : null,
  });
  return parsed.success ? parsed.data : DEFAULT_PROFILE;
});
