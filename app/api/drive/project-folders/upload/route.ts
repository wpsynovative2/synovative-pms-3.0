import { NextResponse } from "next/server";
import { ensurePath, startUpload } from "@/lib/google/agency-drive";
import { projectAreaForCaller } from "@/lib/google/project-drive";
import { fail } from "@/lib/supabase/route-auth";

/** Drive's own limit on a name; deeper than this is almost certainly a mistake. */
const MAX_NAME = 255;
const MAX_DEPTH = 12;

const cleanName = (v: unknown) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME) : "";

/**
 * Starts one file's upload into a project's CSF or 3D Team area and returns
 * the session URL the browser PUTs the file to. `path` is the folder the file
 * sat in inside an uploaded folder ("Renders/Final"), recreated under the area.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    area?: unknown;
    name?: unknown;
    mimeType?: unknown;
    size?: unknown;
    path?: unknown;
  } | null;

  const name = cleanName(body?.name);
  const size = typeof body?.size === "number" && body.size >= 0 ? Math.floor(body.size) : -1;
  const segments = Array.isArray(body?.path) ? body.path.map(cleanName) : [];
  if (!name) return fail(400, "The file needs a name.");
  if (size < 0) return fail(400, "How big is the file?");
  if (
    segments.length > MAX_DEPTH ||
    segments.some((s: string) => !s || s === "." || s === "..")
  ) {
    return fail(400, "That folder path can't be uploaded.");
  }

  const area = await projectAreaForCaller(body?.projectId, body?.area);
  if (area instanceof NextResponse) return area;

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  try {
    const parentId = await ensurePath(area.token, area.folderId, segments);
    const uploadUrl = await startUpload(area.token, {
      parentId,
      name,
      mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
      size,
      origin,
    });
    return NextResponse.json({ uploadUrl });
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : "Google Drive refused the upload.");
  }
}
