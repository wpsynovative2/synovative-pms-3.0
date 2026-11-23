import { NextResponse } from "next/server";
import { IMPORT_BATCH, invoiceColumns, type ImportResult } from "@/lib/invoices";
import { fail } from "@/lib/supabase/route-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { BOOKS_NOT_CONNECTED, booksConfig, customerCompany, findInvoice } from "@/lib/zoho/books";
import { requireInvoiceRight } from "@/lib/zoho/invoice-auth";

export const maxDuration = 60;

/**
 * Fetch invoices from Zoho Books into the PMS:
 *
 *   POST { refs: ["INV-002372", "460000000123456", …] }
 *
 * Each ref is Books' record id or the printed invoice number. One that is new
 * is added; one already here is rewritten from Books (that is what Refetch
 * does). Its links (0012) and follow-ups (0011) are kept: they live in
 * their own tables or columns, and the upsert names only Books' columns.
 *
 * Writes run as the caller, so RLS (can_manage_invoices) is checked again on
 * every row.
 */
export async function POST(request: Request) {
  const caller = await requireInvoiceRight("can_manage_invoices");
  if (caller instanceof NextResponse) return caller;

  const config = booksConfig();
  if (!config) return fail(503, BOOKS_NOT_CONNECTED);

  const body = (await request.json().catch(() => null)) as { refs?: unknown } | null;
  const refs = Array.isArray(body?.refs)
    ? Array.from(new Set(body.refs.map((r) => String(r ?? "").trim()).filter(Boolean)))
    : [];
  if (refs.length === 0) return fail(400, "Enter the invoice ID or invoice number.");
  if (refs.length > IMPORT_BATCH) return fail(400, `At most ${IMPORT_BATCH} invoices at a time.`);

  const sb = await getServerSupabase();
  const results: ImportResult[] = [];
  // One customer's Company Name serves every invoice of theirs in the batch.
  // `false` once Books has refused the contacts API: no point asking again.
  const companies = new Map<string, string | null>();
  let contactsAllowed = true;

  for (const ref of refs) {
    try {
      const raw = await findInvoice(config, ref);
      if (!raw) {
        results.push({ ref, ok: false, error: `No invoice in Zoho Books with ID or number ${ref}.` });
        continue;
      }
      const zohoId = String(raw.invoice_id ?? "");
      if (!zohoId) {
        results.push({ ref, ok: false, error: "Zoho Books returned an invoice without an ID." });
        continue;
      }

      const customerId = String(raw.customer_id ?? "");
      let company: string | null = null;
      if (contactsAllowed && customerId) {
        if (!companies.has(customerId)) companies.set(customerId, await customerCompany(config, customerId));
        company = companies.get(customerId) ?? null;
        if (company === null) contactsAllowed = false;
      }

      const { data: before } = await sb
        .from("invoices")
        .select("id")
        .eq("zoho_invoice_id", zohoId)
        .maybeSingle();

      const { data, error } = await sb
        .from("invoices")
        .upsert(
          {
            zoho_invoice_id: zohoId,
            ...invoiceColumns(raw),
            // Only when Books told us; otherwise keep what the row has.
            ...(company !== null ? { customer_company: company } : {}),
            details: raw,
            fetched_at: new Date().toISOString(),
            fetched_by: caller.id,
          },
          { onConflict: "zoho_invoice_id" },
        )
        .select("id, invoice_number")
        .single();
      if (error) throw new Error(error.message);
      results.push({
        ref,
        ok: true,
        id: data.id as string,
        number: (data.invoice_number as string) || ref,
        created: !before,
      });
    } catch (err) {
      results.push({
        ref,
        ok: false,
        error: err instanceof Error ? err.message : "Zoho Books refused the request.",
      });
    }
  }

  return NextResponse.json({ results });
}
