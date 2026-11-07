import { formatAmount, type CurrencyDefinition, type Digits } from "@/lib/money";

/** One currency of one wallet (or of all wallets) for the summary period. */
export type EmailRow = {
  currency: CurrencyDefinition;
  incomeMinor: number;
  spentMinor: number;
  nowMinor: number;
};

export type EmailBlock = {
  name: string;
  kind: "cash" | "bank" | "card";
  rows: EmailRow[];
};

export type SalaryEmailModel = {
  locale: "en" | "ar";
  digits: Digits;
  /** The day the salary was recorded, YYYY-MM-DD. */
  receivedOn: string;
  /** Start of the summarized period, YYYY-MM-DD; null means "this month". */
  periodFrom: string | null;
  salary: { amountMinor: number; currency: CurrencyDefinition; walletName: string };
  /** Per currency across every wallet. Currencies are never added together. */
  totals: EmailRow[];
  wallets: EmailBlock[];
  /** Absolute link to the app, or null when the public address is not configured. */
  appUrl: string | null;
};

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type RenderedEmail = { subject: string; html: string; text: string };

// Tokens from DESIGN.md: limestone page, ink, teal shell, positive green. Marigold
// is reserved for Add and oxblood for over-budget, so neither appears here.
const C = {
  page: "#eceeea", card: "#ffffff", ink: "#14211f", muted: "#4f625f", grout: "#d3dad4",
  teal: "#0f4c4a", shellFg: "#f4f7f3", shellMuted: "#b9d2ce", mist: "#e1e7e1", green: "#1f7a4d",
  tileOchre: "#b07a00", tileOxblood: "#8e2f3a", tileSage: "#7fa89f",
};

const FONT = "'Readex Pro','Segoe UI',Tahoma,Arial,sans-serif";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortDate(date: string, model: Pick<SalaryEmailModel, "locale" | "digits">): string {
  const [y, m, d] = date.split("-").map(Number);
  const locale = model.digits === "arabic" ? "ar-u-nu-arab" : model.locale === "ar" ? "ar-LB-u-nu-latn" : "en-US";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function money(minor: number, currency: CurrencyDefinition, digits: Digits, sign = false): string {
  return formatAmount(minor, currency, { digits, sign });
}

/** Amounts never mirror: isolate them as left-to-right runs inside RTL text. */
function ltr(value: string): string {
  return `<span dir="ltr" style="unicode-bidi:isolate;">${esc(value)}</span>`;
}

function side(model: Pick<SalaryEmailModel, "locale">, which: "start" | "end"): "left" | "right" {
  return (model.locale === "ar") === (which === "start") ? "right" : "left";
}

function cell(label: string, value: string, color: string, align: "left" | "right", extra = ""): string {
  return `<td class="rule" width="50%" valign="top" style="padding:10px 0 0;text-align:${align};">
    <div class="muted" style="font-size:12px;line-height:16px;color:${C.muted};">${esc(label)}</div>
    <div class="${color === C.green ? "gain" : "ink"}" style="font-size:14px;line-height:20px;font-weight:600;color:${color};${extra}">${value}</div>
  </td>`;
}

function rowHtml(row: EmailRow, model: SalaryEmailModel, t: Translate, first: boolean): string {
  const { digits } = model;
  const S = side(model, "start"), E = side(model, "end");
  const income = row.incomeMinor > 0 ? ltr(money(row.incomeMinor, row.currency, digits, true)) : `<span class="muted" style="color:${C.muted};font-weight:400;">&mdash;</span>`;
  const spent = row.spentMinor > 0 ? ltr(money(-row.spentMinor, row.currency, digits)) : `<span class="muted" style="color:${C.muted};font-weight:400;">&mdash;</span>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${first ? "" : `border-top:1px solid ${C.grout};margin-top:12px;`}" class="${first ? "" : "rule-top"}">
    <tr><td style="padding:${first ? "0" : "12px"} 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="muted" style="font-size:13px;line-height:24px;color:${C.muted};text-align:${S};">${esc(t("now"))}</td>
        <td class="ink" style="font-size:20px;line-height:24px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};text-align:${E};">${ltr(money(row.nowMinor, row.currency, digits))}</td>
      </tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${cell(t("income"), income, C.green, side(model, "start"))}
        ${cell(t("spent"), spent, C.ink, side(model, "end"))}
      </tr></table>
    </td></tr>
  </table>`;
}

function blockHtml(title: string, badge: string | null, rows: EmailRow[], model: SalaryEmailModel, t: Translate, tinted: boolean): string {
  const bg = tinted ? C.mist : C.card;
  const S = side(model, "start"), E = side(model, "end");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${tinted ? "tint" : "tile"}" style="margin:0 0 12px;background:${bg};border:1px solid ${C.grout};border-radius:12px;border-collapse:separate;">
    <tr><td style="padding:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="ink" style="font-size:16px;line-height:24px;font-weight:600;color:${C.ink};text-align:${S};"><bdi>${esc(title)}</bdi></td>
        ${badge ? `<td class="muted" style="font-size:12px;line-height:24px;color:${C.muted};text-align:${E};white-space:nowrap;">${esc(badge)}</td>` : ""}
      </tr></table>
      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
      ${rows.map((row, i) => rowHtml(row, model, t, i === 0)).join("\n")}
    </td></tr>
  </table>`;
}

function tileStrip(): string {
  // The encaustic-tile motif, drawn as table cells so every mail client keeps it.
  const colors = [C.tileSage, C.tileOchre, C.tileOxblood, C.tileSage, C.tileOxblood, C.tileOchre, C.tileSage, C.tileOchre, C.tileOxblood, C.tileSage, C.tileOxblood, C.tileOchre];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
    ${colors.map((color) => `<td height="6" style="height:6px;line-height:6px;font-size:0;background:${color};">&nbsp;</td>`).join("")}
  </tr></table>`;
}

const KIND_KEY = { cash: "kindCash", bank: "kindBank", card: "kindCard" } as const;

export function renderSalaryEmail(model: SalaryEmailModel, t: Translate): RenderedEmail {
  const rtl = model.locale === "ar";
  const S = side(model, "start");
  const dir = rtl ? "rtl" : "ltr";
  const salaryText = money(model.salary.amountMinor, model.salary.currency, model.digits);
  const period = model.periodFrom
    ? t("periodSince", { date: shortDate(model.periodFrom, model) })
    : t("periodMonth");
  const landed = t("landedIn", { wallet: model.salary.walletName, date: shortDate(model.receivedOn, model) });
  const subject = t("subject", { amount: salaryText });
  const preheader = t("preheader", { amount: salaryText, wallet: model.salary.walletName });
  const brand = t("brand");

  const blocks = model.wallets.length === 0
    ? `<p class="muted" style="margin:0;font-size:15px;line-height:22px;color:${C.muted};">${esc(t("empty"))}</p>`
    : [
        model.wallets.length > 1 ? blockHtml(t("allWallets"), null, model.totals, model, t, true) : "",
        ...model.wallets.map((wallet) => blockHtml(wallet.name, t(KIND_KEY[wallet.kind]), wallet.rows, model, t, false)),
      ].join("\n");

  const button = model.appUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;"><tr>
        <td class="cta" bgcolor="${C.teal}" style="background:${C.teal};border-radius:12px;">
          <a href="${esc(model.appUrl)}" style="display:inline-block;padding:13px 22px;font-size:15px;line-height:18px;font-weight:600;color:${C.shellFg};text-decoration:none;">${esc(t("open"))}</a>
        </td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="${model.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @media (prefers-color-scheme: dark) {
    .page { background:#0b1514 !important; }
    .sheet { background:#13211f !important; }
    .tile { background:#13211f !important; border-color:#24403c !important; }
    .tint { background:#1a2d2a !important; border-color:#24403c !important; }
    .ink { color:#e8f0ee !important; }
    .muted { color:#a3bab5 !important; }
    .gain { color:#6fcf9a !important; }
    .rule-top { border-top-color:#24403c !important; }
    .hero { background:#0e3f3d !important; }
    .cta { background:#4fb0a6 !important; }
    .cta a { color:#0b1514 !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${C.page};font-family:${FONT};color:${C.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.page};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px 32px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td class="hero" bgcolor="${C.teal}" style="background:${C.teal};border-radius:16px 16px 0 0;padding:28px 24px 26px;text-align:${S};">
      <div style="font-size:13px;line-height:18px;font-weight:600;letter-spacing:0.02em;color:${C.shellMuted};">${esc(brand)}</div>
      <h1 style="margin:14px 0 0;font-size:22px;line-height:28px;font-weight:700;color:${C.shellFg};">${esc(t("heading"))}</h1>
      <div style="margin:6px 0 0;font-size:40px;line-height:46px;font-weight:700;letter-spacing:-0.025em;color:${C.shellFg};">${ltr(salaryText)}</div>
      <div style="margin:8px 0 0;font-size:14px;line-height:20px;color:${C.shellMuted};"><bdi>${esc(landed)}</bdi></div>
    </td></tr>
    <tr><td>${tileStrip()}</td></tr>
    <tr><td class="sheet" bgcolor="${C.card}" style="background:${C.card};border-radius:0 0 16px 16px;padding:24px 20px 28px;text-align:${S};">
      <h2 class="ink" style="margin:0 0 16px;font-size:17px;line-height:26px;font-weight:600;color:${C.ink};">${esc(period)}</h2>
      ${blocks}
      <p class="muted" style="margin:12px 0 0;font-size:12px;line-height:18px;color:${C.muted};">${esc(t("note"))}</p>
      ${button}
    </td></tr>
    <tr><td style="padding:16px 8px 0;text-align:center;">
      <p class="muted" style="margin:0;font-size:12px;line-height:18px;color:${C.muted};">${esc(t("why"))}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const line = (row: EmailRow) => [
    `  ${t("now")}: ${money(row.nowMinor, row.currency, model.digits)}`,
    `  ${t("income")}: ${row.incomeMinor > 0 ? money(row.incomeMinor, row.currency, model.digits, true) : "-"}`,
    `  ${t("spent")}: ${row.spentMinor > 0 ? money(-row.spentMinor, row.currency, model.digits) : "-"}`,
  ].join("\n");
  const textBlocks = model.wallets.length === 0 ? [t("empty")] : [
    ...(model.wallets.length > 1 ? [`${t("allWallets")}\n${model.totals.map(line).join("\n\n")}`] : []),
    ...model.wallets.map((wallet) => `${wallet.name} (${t(KIND_KEY[wallet.kind])})\n${wallet.rows.map(line).join("\n\n")}`),
  ];
  const text = [
    `${t("heading")}: ${salaryText}`, landed, "", period, "", textBlocks.join("\n\n"), "", t("note"),
    ...(model.appUrl ? ["", `${t("open")}: ${model.appUrl}`] : []), "", t("why"),
  ].join("\n");

  return { subject, html, text };
}
