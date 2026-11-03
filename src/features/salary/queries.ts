import "server-only";
import { demoPage } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { todayIn } from "@/features/transactions/group";
import type { SalaryStatus } from "./schema";

/** Latest "Got salary" entry and whether it is in the current month. */
export async function getSalaryStatus(timezone: string): Promise<SalaryStatus> {
  let last: string | null = null;
  if (!supabaseConfigured()) {
    // Demo data has no source tag; its salary rows carry the note "Salary".
    const salary = demoPage({ q: "Salary", kind: "income" }, null, 1).rows[0];
    last = salary?.occurredOn ?? null;
  } else {
    const supabase = await createClient();
    const { data } = await supabase
      .from("transactions")
      .select("occurred_on")
      .eq("source", "salary")
      .is("deleted_at", null)
      .order("occurred_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    last = data?.occurred_on ?? null;
  }
  const month = todayIn(timezone).slice(0, 7);
  return { lastReceivedOn: last, receivedThisMonth: last !== null && last.startsWith(month) };
}
