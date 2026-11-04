import { NextResponse } from "next/server";
import {
  agencyDriveConfig,
  agencyToken,
  startUpload,
  thumbnailFileName,
  thumbnailsFolderId,
} from "@/lib/google/agency-drive";
import { canUploadThreeDThumbnail } from "@/lib/permissions";
import { getServerSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";

/** The browser compresses first (lib/thumbnail.ts), so anything near this is a mistake. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_NAME = 255;

const cleanName = (v: unknown) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim() : "";

/**
 * Opens the upload of one task thumbnail into the master folder on Drive, and returns
 * the session URL the browser PUTs the JPEG to (0026). The project is read as the
 * caller, so Row Level Security decides whether they can see it.
 */
export async function POST(request: Request) {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    taskTitle?: unknown;
    thumbnailName?: unknown;
    size?: unknown;
  } | null;
  const size = typeof body?.size === "number" ? Math.floor(body.size) : -1;
  if (typeof body?.projectId !== "string" || !body.projectId) return fail(400, "Which project?");
  if (size <= 0) return fail(400, "How big is the image?");
  if (size > MAX_BYTES) return fail(413, "That image is over 5 MB even after compressing.");

  const config = agencyDriveConfig();
  if (!config) {
    return fail(
      503,
      "The agency Google account isn't connected yet. Add GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN and GOOGLE_3D_FOLDER_ID to the environment.",
    );
  }

  const sb = await getServerSupabase();
  const { data: project, error } = await sb
    .from("projects")
    .select("name, is_3d, leader_id")
    .eq("id", body.projectId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!project) return fail(404, "That project no longer exists.");
  if (!project.is_3d) return fail(409, "Only a 3D project's tasks have thumbnails.");
  if (!canUploadThreeDThumbnail(caller, { leaderId: project.leader_id as string | null })) {
    return fail(403, "You can't add a thumbnail on this project.");
  }

  // Every project shares one folder, so without a name of its own, the file's has to
  // say whose it is.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const task = cleanName(body.taskTitle) || "Untitled task";
  const name =
    thumbnailFileName(body.thumbnailName) ||
    `${cleanName(project.name)} - ${task}`.slice(0, MAX_NAME - 22) + ` - ${stamp}.jpg`;

  try {
    const token = await agencyToken(config);
    const uploadUrl = await startUpload(token, {
      parentId: await thumbnailsFolderId(token, config),
      name,
      mimeType: "image/jpeg",
      size,
      origin: request.headers.get("origin") ?? new URL(request.url).origin,
    });
    return NextResponse.json({ uploadUrl });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the upload.");
  }
}
