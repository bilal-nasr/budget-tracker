import { after } from "next/server";
import { sendMail, smtpSettings } from "./send";

/**
 * Emails the wallet summary once the response has gone out, so pressing "Got
 * salary" never waits on mail. A mail problem never affects the recorded salary.
 * The query code loads lazily: it is server-only and only needed when mail is on.
 */
export function scheduleSalaryEmail(receiptId: string): void {
  if (!smtpSettings()) return;
  try {
    after(async () => {
      try {
        const { buildSalaryEmail } = await import("./summary");
        const { getLocale } = await import("next-intl/server");
        const message = await buildSalaryEmail(receiptId, await getLocale().catch(() => undefined));
        if (message) await sendMail(message);
      } catch (error) {
        console.error("salary summary email failed", error instanceof Error ? error.message : "unknown");
      }
    });
  } catch {
    // Outside a request (for example in unit tests) there is nothing to schedule.
  }
}
