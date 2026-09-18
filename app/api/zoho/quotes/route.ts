import { NextResponse } from "next/server";
import { BUSINESS_DEV_DEPARTMENT } from "@/lib/master-data";
import { fail, requireCaller } from "@/lib/supabase/route-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { fetchQuote, zohoConfig } from "@/lib/zoho/crm";

/**
 * One quote for the New OBC form:
 *
 *   ?ref=<record id or quote number> → that quote with its line items
 *
 * The user pastes whichever number they have in front of them; the client
 * sorts out which it is.
 *
 * Reading the sales pipeline is limited to the people who raise OBCs: the
 * global managers, plus Business Development Executives — whose right comes
 * from their department rather than their role, exactly as it does in the app.
 */
export async function GET(request: Request) {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const manager = ["super_admin", "admin", "manager"].includes(caller.role);
  if (!manager) {
    const sb = await getServerSupabase();
    const { data } = await sb
      .from("profile_departments")
      .select("department")
      .eq("profile_id", caller.id)
      .eq("department", BUSINESS_DEV_DEPARTMENT)
      .maybeSingle();
    if (!data) return fail(403, "Your role can't read the sales pipeline.");
  }

  const config = zohoConfig();
  if (!config) {
    return fail(
      503,
      "Zoho CRM isn't connected yet. Add ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN to the environment.",
    );
  }

  const url = new URL(request.url);
  const reference = (url.searchParams.get("ref") ?? "").trim();
  if (!reference) return fail(400, "Enter the quote ID or quote number.");

  try {
    const found = await fetchQuote(config, reference);
    if (!found) return fail(404, `No quote in Zoho with ID or number ${reference}.`);
    return NextResponse.json(found);
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Zoho refused the request.");
  }
}
