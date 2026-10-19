import { NextResponse, type NextRequest } from "next/server";
import { listFolder } from "@/lib/google/agency-drive";
import { projectAreaForCaller } from "@/lib/google/project-drive";
import { fail } from "@/lib/supabase/route-auth";

/** What is in a project's CSF or 3D Team area, for whoever may see that area. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const area = await projectAreaForCaller(params.get("projectId"), params.get("area"));
  if (area instanceof NextResponse) return area;
  try {
    return NextResponse.json({ items: await listFolder(area.token, area.folderId) });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the request.");
  }
}
