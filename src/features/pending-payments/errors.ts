import type { ActionError } from "@/lib/supabase/action";
export function pendingErrorKey(error: ActionError) {
  switch (error) {
    case "notConfigured": return "errorPreview";
    case "invalid": return "errorInvalid";
    case "conflict": return "errorConflict";
    case "exceedsRemaining": return "errorTooMuch";
    case "totalBelowPaid": return "errorBelowPaid";
    case "inUse": return "errorInUse";
    case "walletUnavailable": return "errorWallet";
    case "categoryUnavailable": return "errorCategory";
    default: return "errorFailed";
  }
}
