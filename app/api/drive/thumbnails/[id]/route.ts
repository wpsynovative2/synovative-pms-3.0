import { NextResponse, type NextRequest } from "next/server";
import {
  agencyDriveConfig,
  agencyToken,
  renameThumbnail,
  thumbnailFileName,
  thumbnailMedia,
  thumbnailsFolderId,
} from "@/lib/google/agency-drive";
import { canUploadThreeDThumbnail } from "@/lib/permissions";
import { getServerSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";

/**
 * Serves one task thumbnail (0026). The files on Drive stay private, so this is how
 * anyone sees them, and it reads with the agency account. So it must not become a way
 * to read anything else in that account: the caller has to be able to read a task
 * naming the file (Row Level Security decides), and since a task's columns are written
 * by people, the file must also sit in the thumbnails folder and be a JPEG.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/drive/thumbnails/[id]">,
) {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return fail(400, "That isn't a thumbnail.");

  const sb = await getServerSupabase();
  const { data: tasks, error } = await sb
    .from("tasks")
    .select("id")
    .eq("thumbnail_file_id", id)
    .limit(1);
  if (error) return fail(500, error.message);
  if (!tasks?.length) return fail(404, "That thumbnail isn't available.");

  const config = agencyDriveConfig();
  if (!config) return fail(503, "The agency Google account isn't connected yet.");

  try {
    const token = await agencyToken(config);
    const media = await thumbnailMedia(token, id, await thumbnailsFolderId(token, config));
    if (!media) return fail(404, "That thumbnail isn't available.");
    return new NextResponse(media, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the request.");
  }
}

/**
 * Gives a thumbnail's file the name typed for it (0027), for whoever may upload one
 * to the project. No task may name the file yet, so unlike reading, this can't look
 * for one: the project is read as the caller, and the file must be in the folder.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/drive/thumbnails/[id]">,
) {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return fail(400, "That isn't a thumbnail.");
  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    name?: unknown;
  } | null;
  const name = thumbnailFileName(body?.name);
  if (!name) return fail(400, "What should it be called?");
  if (typeof body?.projectId !== "string" || !body.projectId) return fail(400, "Which project?");

  const sb = await getServerSupabase();
  const { data: project, error } = await sb
    .from("projects")
    .select("is_3d, leader_id")
    .eq("id", body.projectId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!project?.is_3d) return fail(404, "That project no longer exists.");
  if (!canUploadThreeDThumbnail(caller, { leaderId: project.leader_id as string | null })) {
    return fail(403, "You can't rename a thumbnail on this project.");
  }

  const config = agencyDriveConfig();
  if (!config) return fail(503, "The agency Google account isn't connected yet.");

  try {
    const token = await agencyToken(config);
    const folderId = await thumbnailsFolderId(token, config);
    if (!(await renameThumbnail(token, id, folderId, name))) {
      return fail(404, "That thumbnail isn't available.");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the request.");
  }
}
