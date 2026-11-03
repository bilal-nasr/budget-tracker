import "server-only";

/** Logs how long `work` took when DEBUG_TIMING=1; otherwise just runs it. */
export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (process.env.DEBUG_TIMING !== "1") return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    console.log(`[timing] ${label} ${Math.round(performance.now() - start)}ms`);
  }
}
