/** Finite recovery code for stale category selections; never expose DB messages. */
export function categoryReferenceError(error: { message?: string } | null | undefined): "categoryUnavailable" | undefined {
  return error?.message === "category_unavailable" || error?.message === "category_not_found" || error?.message === "category not found" ? "categoryUnavailable" : undefined;
}
