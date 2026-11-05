import { getExportData } from "@/features/export/data";
import { writeExportWorkbook } from "@/features/export/workbook";
import type { ExportLocale } from "@/features/export/model";
import { parseExportOptions } from "@/features/export/options";
import { supabaseConfigured } from "@/lib/supabase/proxy";
import { getUserId } from "@/lib/supabase/user";

export const runtime = "nodejs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PRIVATE_NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

function privateHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", PRIVATE_NO_STORE);
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return headers;
}

function isExportLocale(value: string): value is ExportLocale {
  return value === "en" || value === "ar";
}

export async function GET(
  request: Request,
  context: RouteContext<"/[locale]/settings/export">,
): Promise<Response> {
  const { locale } = await context.params;
  if (!isExportLocale(locale)) {
    return Response.json({ error: "notFound" }, { status: 404, headers: privateHeaders() });
  }
  const options = parseExportOptions(new URL(request.url).searchParams);
  if (!options) {
    return Response.json({ error: "badRequest" }, { status: 400, headers: privateHeaders() });
  }
  try {
    if (supabaseConfigured() && !(await getUserId())) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: privateHeaders() });
    }
    // One cutoff anchors both complete snapshot reads and the serialized workbook.
    const exportedAt = new Date();
    const data = await getExportData(locale, exportedAt);
    const buffer = await writeExportWorkbook(data, options);
    return new Response(Uint8Array.from(buffer), {
      status: 200,
      headers: privateHeaders({
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${options.mode === "simple" ? "budget-summary" : "budget-export"}-${data.cutoffDate}.xlsx"`,
        "Content-Length": String(buffer.byteLength),
        "X-Content-Type-Options": "nosniff",
      }),
    });
  } catch {
    return Response.json({ error: "exportUnavailable" }, { status: 500, headers: privateHeaders() });
  }
}
