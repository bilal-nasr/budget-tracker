import type en from "@/messages/en.json";

type LoanErrorMessage = keyof typeof en.Loans;

export function loanErrorKey(error: string): LoanErrorMessage {
  switch (error) {
    case "notConfigured": return "errorPreview";
    case "invalid": return "errorInvalid";
    case "conflict": return "errorConflict";
    case "exceedsRemaining": return "tooMuch";
    case "paymentOrder": return "errorOrder";
    case "loanClosed": return "errorClosed";
    case "inUse": return "errorInUse";
    case "termsLocked": return "termsLocked";
    default: return "errorFailed";
  }
}
