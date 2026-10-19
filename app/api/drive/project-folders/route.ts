import { NextResponse } from "next/server";
import { agencyDriveConfig, createProjectFolder } from "@/lib/google/agency-drive";
import { getServerSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";

/**
 * "Create Drive folder" on a project selling a 3D walkthrough — makes
 * 3D Operation Work / <project name> / {CSF, 3D Team} as the agency account
 * and returns the ids; the client records them through
 * set_project_drive_folders (0015).
 *
 * The name is read from the database rather than the request, and
 * can_create_project_drive is asked as the caller, so nobody makes folders for
 * a project they could not record them on.
 */
export async function POST(request: Request) {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const config = agencyDriveConfig();
  if (!config) {
    return fail(
      503,
      "The agency Google account isn't connected yet. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN and GOOGLE_3D_FOLDER_ID to the environment.",
    );
  }

  const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
  const projectId = body?.projectId;
  if (!projectId) return fail(400, "Which project?");

  const sb = await getServerSupabase();
  const [{ data: project, error }, { data: allowed }] = await Promise.all([
    sb
      .from("projects")
      .select("id, name, drive_folder_id, drive_csf_folder_id, drive_team3d_folder_id")
      .eq("id", projectId)
      .maybeSingle(),
    sb.rpc("can_create_project_drive", { p_project_id: projectId }),
  ]);
  if (error) return fail(500, error.message);
  if (!project) return fail(404, "That project no longer exists.");
  if (!allowed) return fail(403, "You can't create this project's Drive folder.");

  // Already made: hand back what is there rather than making a second one.
  if (project.drive_folder_id) {
    return NextResponse.json({
      folderId: project.drive_folder_id,
      csfFolderId: project.drive_csf_folder_id,
      team3dFolderId: project.drive_team3d_folder_id,
    });
  }

  try {
    return NextResponse.json(await createProjectFolder(config, project.name as string));
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the request.");
  }
}
