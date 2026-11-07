import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/supabase/user";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { DEMO_RATE, DEMO_SALARY } from "@/lib/demo-data";
import { DEFAULT_PROFILE, profileSchema, type Profile } from "./schema";

type ProfileRow = {
  locale: string;
  digits: string;
  theme: string;
  timezone: string;
  onboarded_at: string | null;
  salary_amount_minor?: number | string | null;
  /** Exact durable balance selected for the saved salary configuration. */
  salary_balance_id?: string | null;
  usd_lbp_rate?: number | null;
  default_currency?: string | null;
  salary_email_enabled?: boolean | null;
};

/** The signed-in owner's profile. Falls back to defaults when Supabase is not configured. */
export const getProfile = cache(async (): Promise<Profile> => {
  if (!supabaseConfigured()) return { ...DEFAULT_PROFILE, salary: DEMO_SALARY, usdLbpRate: DEMO_RATE };

  const userId = await getUserId();
  if (!userId) return DEFAULT_PROFILE;
  const supabase = await createClient();

  // Newer columns come from later migrations; fall back to older column sets if one is not applied yet.
  const columnSets = [
    "locale, digits, theme, timezone, onboarded_at, salary_amount_minor, salary_balance_id, usd_lbp_rate, default_currency, salary_email_enabled",
    "locale, digits, theme, timezone, onboarded_at, salary_amount_minor, salary_balance_id, usd_lbp_rate, default_currency",
    "locale, digits, theme, timezone, onboarded_at, salary_amount_minor, salary_balance_id, usd_lbp_rate",
    "locale, digits, theme, timezone, onboarded_at, salary_amount_minor, salary_balance_id",
    "locale, digits, theme, timezone, onboarded_at",
  ];
  let data: ProfileRow | null = null;
  for (const columns of columnSets) {
    const result = await supabase.from("profiles").select(columns).eq("user_id", userId).maybeSingle();
    if (!result.error) {
      data = result.data as ProfileRow | null;
      break;
    }
  }
  if (!data) return { ...DEFAULT_PROFILE, onboarded: false };

  const parsed = profileSchema.safeParse({
    locale: data.locale,
    digits: data.digits,
    theme: data.theme,
    timezone: data.timezone,
    onboarded: data.onboarded_at !== null,
    usdLbpRate: data.usd_lbp_rate ?? null,
    defaultCurrency: data.default_currency ?? null,
    salaryEmail: data.salary_email_enabled ?? true,
    salary:
      data.salary_amount_minor != null && data.salary_balance_id != null
        ? { amountMinor: Number(data.salary_amount_minor), balanceId: data.salary_balance_id }
        : null,
  });
  return parsed.success ? parsed.data : DEFAULT_PROFILE;
});
