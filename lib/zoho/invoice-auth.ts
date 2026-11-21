import "server-only";

import { NextResponse } from "next/server";
import { fail, requireCaller, type Caller } from "@/lib/supabase/route-auth";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The invoice routes ask the database who may do what rather than repeating
 * the rule: can_manage_invoices() / can_view_invoices() (0009) are the same
 * predicates RLS applies to the rows these routes write.
 */
export async function requireInvoiceRight(
  right: "can_manage_invoices" | "can_view_invoices",
): Promise<Caller | NextResponse> {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;
  const sb = await getServerSupabase();
  const { data, error } = await sb.rpc(right);
  if (error) {
    return fail(
      500,
      /could not find|does not exist/i.test(error.message)
        ? "The invoices migration (0009) hasn't been run on this database yet."
        : error.message,
    );
  }
  if (data !== true) {
    return fail(
      403,
      right === "can_manage_invoices"
        ? "Only Accounts & Finance and Super Admins can fetch invoices."
        : "Your role can't see invoices.",
    );
  }
  return caller;
}
