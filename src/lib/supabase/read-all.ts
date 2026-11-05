/** Keyset pages below the configured API cap; reject partial/error or repeated pages. */
export async function readAllByKey<T>(
  load: (after: string | null, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  keyOf: (row: T) => string,
  errorMessage: string,
): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await load(after, pageSize);
    if (page.error || !Array.isArray(page.data) || page.data.length > pageSize) throw new Error(errorMessage);
    let previous: string | null = after;
    for (const row of page.data) {
      const key = keyOf(row);
      if (typeof key !== "string" || key.length === 0 || (previous !== null && key <= previous)) throw new Error(errorMessage);
      rows.push(row);
      previous = key;
    }
    if (page.data.length < pageSize) return rows;
    after = previous;
  }
}
