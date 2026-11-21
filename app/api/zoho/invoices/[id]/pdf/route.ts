import { NextResponse, type NextRequest } from "next/server";
import { fail } from "@/lib/supabase/route-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { BOOKS_NOT_CONNECTED, booksConfig, invoicePdf } from "@/lib/zoho/books";
import { requireInvoiceRight } from "@/lib/zoho/invoice-auth";

/**
 * An invoice's PDF, rendered by Books with the organisation's own template.
 *
 * The id is the PMS invoice id, not Books': the row is read as the caller, so
 * only invoices already in the PMS — and visible to them — can be downloaded.
 * The route cannot be used to read anything else out of Books.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/zoho/invoices/[id]/pdf">) {
  const caller = await requireInvoiceRight("can_view_invoices");
  if (caller instanceof NextResponse) return caller;
  const { id } = await ctx.params;

  const config = booksConfig();
  if (!config) return fail(503, BOOKS_NOT_CONNECTED);

  const sb = await getServerSupabase();
  const { data: row } = await sb
    .from("invoices")
    .select("zoho_invoice_id, invoice_number")
    .eq("id", id)
    .maybeSingle();
  if (!row) return fail(404, "That invoice isn't in the PMS.");

  try {
    const pdf = await invoicePdf(config, row.zoho_invoice_id as string);
    const name = String(row.invoice_number || "invoice").replace(/[^\w.-]+/g, "_");
    return new Response(pdf.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${name}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Zoho Books refused the request.");
  }
}
