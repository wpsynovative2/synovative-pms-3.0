import { NextResponse, type NextRequest } from "next/server";
import { fail } from "@/lib/supabase/route-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { BOOKS_NOT_CONNECTED, booksConfig, booksWebUrl } from "@/lib/zoho/books";
import { requireInvoiceRight } from "@/lib/zoho/invoice-auth";

/**
 * Open an invoice in Zoho Books' own web app:
 * https://books.zoho.in/app/<organisation>#/invoices/<Books invoice id>.
 *
 * A redirect rather than a link built in the browser, so the organisation id
 * stays in the server's environment. The id is the PMS invoice id, read as the
 * caller, so it only opens invoices they can see here; Books then asks them to
 * sign in as usual.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/zoho/invoices/[id]/open">) {
  const caller = await requireInvoiceRight("can_view_invoices");
  if (caller instanceof NextResponse) return caller;
  const { id } = await ctx.params;

  const config = booksConfig();
  if (!config) return fail(503, BOOKS_NOT_CONNECTED);

  const sb = await getServerSupabase();
  const { data: row } = await sb.from("invoices").select("zoho_invoice_id").eq("id", id).maybeSingle();
  if (!row) return fail(404, "That invoice isn't in the PMS.");

  return NextResponse.redirect(booksWebUrl(config, row.zoho_invoice_id as string));
}
