import { NextResponse } from "next/server";
import { SYNC_FILTERS, SYNC_STATUSES, type SyncCandidate, type SyncFilterResult } from "@/lib/invoices";
import { fail } from "@/lib/supabase/route-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { BOOKS_NOT_CONNECTED, booksConfig, listInvoices, type BooksInvoiceSummary } from "@/lib/zoho/books";
import { requireInvoiceRight } from "@/lib/zoho/invoice-auth";

export const maxDuration = 60;

/**
 * Step one of a sync: which invoices in Books' working views are not in the
 * PMS yet. Nothing is written here — the browser then imports the new ones in
 * small batches through POST /api/zoho/invoices, so a long first sync never
 * runs into a timeout and shows its progress as it goes.
 *
 * Invoices already in the PMS are left alone, whatever Books now says about
 * them; refetching one is a separate, deliberate step.
 */
export async function GET() {
  const caller = await requireInvoiceRight("can_manage_invoices");
  if (caller instanceof NextResponse) return caller;

  const config = booksConfig();
  if (!config) return fail(503, BOOKS_NOT_CONNECTED);

  const filters: SyncFilterResult[] = [];
  const found = new Map<string, BooksInvoiceSummary>();

  // One view at a time: Books allows about 100 calls a minute per organisation.
  for (const f of SYNC_FILTERS) {
    let rows: BooksInvoiceSummary[] | null = null;
    let error = "";
    // The view's filter_by where Books has one, then the plain status
    // parameter. The last refusal is the one reported: it is the more telling
    // (a filter name Books rejects is checked before access to the books).
    const attempts: Record<string, string>[] = [
      ...(f.filterBy ? [{ filter_by: f.filterBy }] : []),
      { status: f.status },
    ];
    for (const params of attempts) {
      try {
        rows = await listInvoices(config, params);
        break;
      } catch (err) {
        error = err instanceof Error ? err.message : "Zoho Books refused this view.";
      }
    }
    if (!rows) {
      filters.push({ label: f.label, count: 0, error });
      continue;
    }
    const kept = rows.filter((r) => r.invoice_id && SYNC_STATUSES.has(r.status ?? ""));
    for (const r of kept) found.set(r.invoice_id, r);
    filters.push({ label: f.label, count: kept.length });
  }

  if (filters.every((f) => f.error)) {
    return fail(502, filters[0]?.error || "Zoho Books refused the request.");
  }

  const sb = await getServerSupabase();
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("invoices")
      .select("zoho_invoice_id")
      .order("id")
      .range(from, from + 999);
    if (error) return fail(500, error.message);
    for (const row of data ?? []) existing.add(row.zoho_invoice_id as string);
    if (!data || data.length < 1000) break;
  }

  const fresh: SyncCandidate[] = [];
  let alreadyHere = 0;
  for (const r of found.values()) {
    if (existing.has(r.invoice_id)) {
      alreadyHere += 1;
      continue;
    }
    fresh.push({
      zohoId: r.invoice_id,
      number: r.invoice_number ?? "",
      customer: r.customer_name ?? "",
      status: r.status ?? "",
    });
  }

  return NextResponse.json({ filters, matched: found.size, alreadyHere, fresh });
}
