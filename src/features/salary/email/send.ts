import nodemailer from "nodemailer";

export type MailMessage = { to: string; subject: string; html: string; text: string };

type SmtpSettings = { host: string; port: number; user: string; pass: string; from: string };

/** SMTP settings from the environment, or null when mail is not set up. */
export function smtpSettings(env: Record<string, string | undefined> = process.env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const from = env.SMTP_FROM?.trim() || `Budget Tracker <${user}>`;
  return { host, port, user, pass, from };
}

/** Sends one message. Resolves false (never throws) when SMTP is not configured. */
export async function sendMail(message: MailMessage, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const settings = smtpSettings(env);
  if (!settings) return false;
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is implicit TLS; 587 and others upgrade with STARTTLS.
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({ from: settings.from, ...message });
  return true;
}
