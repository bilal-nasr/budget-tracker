export function categoryErrorMessageKey(error: string) {
  switch (error) {
    case "notConfigured": return "errorPreview";
    case "duplicateName": return "errorDuplicate";
    case "inUse": return "errorInUse";
    case "invalid": return "errorInvalid";
    case "categoryUnavailable": return "errorUnavailable";
    default: return "errorFailed";
  }
}
