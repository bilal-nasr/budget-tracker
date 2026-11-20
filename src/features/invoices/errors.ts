import type { ActionError } from "@/lib/supabase/action";

/** Keys of the `Invoices` message namespace. */
export function invoiceErrorKey(error: ActionError) {
  switch (error) {
    case "notConfigured": return "errorPreview";
    case "invalid": return "errorInvalid";
    case "conflict": return "errorConflict";
    case "linkInvalid": return "errorLink";
    case "limitReached": return "errorLimit";
    case "paymentChanged": return "errorPaid";
    case "walletUnavailable": return "errorWallet";
    case "categoryUnavailable": return "errorExpenseCategory";
    case "currencyUnavailable":
    case "currencyDisabled": return "errorCurrency";
    default: return "errorFailed";
  }
}
