import "server-only";

import { NextResponse } from "next/server";
import { PROJECT_DRIVE_AREAS, type ProjectDriveArea } from "@/lib/master-data";
import { canUseProjectDriveArea } from "@/lib/permissions";
import { getServerSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";
import { agencyDriveConfig, agencyToken, isProjectArea } from "./agency-drive";

export const isDriveArea = (v: unknown): v is ProjectDriveArea =>
  typeof v === "string" && v in PROJECT_DRIVE_AREAS;

/**
 * Everything a project Drive route checks before it touches Drive: the caller
 * is signed in, can see the project (read as them, so Row Level Security
 * decides), may use this area (canUseProjectDriveArea, from their own role and
 * departments), the folder exists, and it really sits under 3D Operation Work.
 */
export async function projectAreaForCaller(
  projectId: unknown,
  area: unknown,
): Promise<{ token: string; folderId: string } | NextResponse> {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;
  if (typeof projectId !== "string" || !projectId) return fail(400, "Which project?");
  if (!isDriveArea(area)) return fail(400, "Which folder?");

  const config = agencyDriveConfig();
  if (!config) {
    return fail(
      503,
      "The agency Google account isn't connected yet. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN and GOOGLE_3D_FOLDER_ID to the environment.",
    );
  }

  const sb = await getServerSupabase();
  const [{ data: project, error }, { data: depts }] = await Promise.all([
    sb
      .from("projects")
      .select("id, drive_folder_id, drive_csf_folder_id, drive_team3d_folder_id")
      .eq("id", projectId)
      .maybeSingle(),
    sb.from("profile_departments").select("department").eq("profile_id", caller.id),
  ]);
  if (error) return fail(500, error.message);
  if (!project) return fail(404, "That project no longer exists.");

  const departments = (depts ?? []).map((d) => d.department as string);
  if (!canUseProjectDriveArea({ role: caller.role, departments }, area)) {
    return fail(403, `You can't open ${PROJECT_DRIVE_AREAS[area]} on this project.`);
  }

  const folderId = (
    area === "csf" ? project.drive_csf_folder_id : project.drive_team3d_folder_id
  ) as string;
  if (!project.drive_folder_id || !folderId) {
    return fail(409, "This project has no Drive folder yet.");
  }

  try {
    const token = await agencyToken(config);
    if (!(await isProjectArea(token, config, project.drive_folder_id as string, folderId))) {
      return fail(409, "This project's Drive folder isn't inside 3D Operation Work.");
    }
    return { token, folderId };
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the request.");
  }
}
