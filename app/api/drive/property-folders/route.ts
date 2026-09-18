import { NextResponse } from "next/server";
import { createPropertyTree, driveConfig } from "@/lib/google/drive";
import { PROPERTY_MEDIA_FOLDERS } from "@/lib/master-data";
import { getServerSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";

/**
 * "Create Directory" on a property — builds
 * Clients / <company> / <client> / <property> / {media folders} on Drive and
 * returns the folder ids so the property can link straight into them.
 *
 * The folder names are read from the database rather than the request, so a
 * caller cannot make folders for a property they cannot see. Every step is
 * find-or-create, so pressing the button twice is harmless.
 */
export async function POST(request: Request) {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const config = driveConfig();
  if (!config) {
    return fail(
      503,
      "Google Drive isn't set up yet. Add GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_DRIVE_PARENT_FOLDER_ID to the environment.",
    );
  }

  const body = (await request.json().catch(() => null)) as { propertyId?: string } | null;
  const propertyId = body?.propertyId;
  if (!propertyId) return fail(400, "Which property?");

  // Read as the caller: Row Level Security decides whether they may see it.
  const sb = await getServerSupabase();
  const { data: property, error } = await sb
    .from("properties")
    .select("id, name, drive_folder_id, company_id, client_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!property) return fail(404, "That property no longer exists.");

  const [{ data: company }, { data: client }] = await Promise.all([
    sb.from("companies").select("name").eq("id", property.company_id).maybeSingle(),
    property.client_id
      ? sb.from("clients").select("full_name").eq("id", property.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  try {
    const result = await createPropertyTree(
      config,
      {
        company: company?.name ?? "Unfiled company",
        // A property with no named contact still needs somewhere to live.
        client: client?.full_name ?? "Unassigned client",
        property: property.name,
      },
      PROPERTY_MEDIA_FOLDERS,
    );
    return NextResponse.json(result);
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the request.");
  }
}
