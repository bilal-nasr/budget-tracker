import type { ActionError } from "@/lib/supabase/action";

export function itemErrorKey(error: ActionError) {
  switch (error) {
    case "notConfigured": return "errorPreview";
    case "invalid": return "errorInvalid";
    case "conflict": return "errorConflict";
    case "walletUnavailable": return "errorWallet";
    case "categoryUnavailable": return "errorCategory";
    case "currencyUnavailable":
    case "currencyDisabled": return "errorCurrency";
    default: return "errorFailed";
  }
}
