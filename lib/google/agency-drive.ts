import "server-only";

import { PROJECT_DRIVE_AREAS } from "@/lib/master-data";
import { driveError, escape, findOrCreate, folderUrl } from "./drive";

/**
 * Drive as the agency's own Google account rather than the service account.
 *
 * The service account can make folders but owns no storage, and a file it
 * uploads into a personal Drive is refused. Project media is uploaded instead
 * as the account that owns "3D Operation Work" (and its storage plan), through
 * a refresh token minted once with `npm run google-auth`. Same shape as the
 * Zoho connection.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface AgencyDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** "3D Operation Work": every project folder is made inside it. */
  threeDFolderId: string;
}

export function agencyDriveConfig(): AgencyDriveConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const threeDFolderId = process.env.GOOGLE_3D_FOLDER_ID;
  if (!clientId || !clientSecret || !refreshToken || !threeDFolderId) return null;
  return { clientId, clientSecret, refreshToken, threeDFolderId };
}

/** An hour's access token, kept in module scope as the Zoho one is. */
let cached: { token: string; expiresAt: number } | null = null;

export async function agencyToken(config: AgencyDriveConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(
      body.error === "invalid_grant"
        ? "The Google account connection has expired. Run npm run google-auth again."
        : body.error_description || "Google refused the agency account.",
    );
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/**
 * <project name> with CSF and 3D Team inside. The project folder is always a
 * new one - two projects with the same name must not share files - while the
 * areas are find-or-create, so a retry after a half-finished run is harmless.
 */
export async function createProjectFolder(config: AgencyDriveConfig, projectName: string) {
  const token = await agencyToken(config);
  const res = await fetch(`${DRIVE_URL}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: projectName.trim() || "Untitled project",
      mimeType: FOLDER_MIME,
      parents: [config.threeDFolderId],
    }),
  });
  if (!res.ok) throw new Error(await driveError(res));
  const { id: folderId } = (await res.json()) as { id: string };
  const csf = await findOrCreate(token, folderId, PROJECT_DRIVE_AREAS.csf);
  const team3d = await findOrCreate(token, folderId, PROJECT_DRIVE_AREAS.team3d);
  return { folderId, csfFolderId: csf.folderId, team3dFolderId: team3d.folderId };
}

async function parentsOf(token: string, id: string): Promise<string[]> {
  const res = await fetch(
    `${DRIVE_URL}/${encodeURIComponent(id)}?fields=parents&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return [];
  return ((await res.json()) as { parents?: string[] }).parents ?? [];
}

/**
 * The ids on a project row are written by people, so before uploading into one
 * check it really is <3D Operation Work> / <project folder> / <area>.
 */
export async function isProjectArea(
  token: string,
  config: AgencyDriveConfig,
  projectFolderId: string,
  areaFolderId: string,
): Promise<boolean> {
  const [areaParents, projectParents] = await Promise.all([
    parentsOf(token, areaFolderId),
    parentsOf(token, projectFolderId),
  ]);
  return areaParents.includes(projectFolderId) && projectParents.includes(config.threeDFolderId);
}

/** Walks a folder path under `parentId`, making what is missing; returns the last id. */
export async function ensurePath(token: string, parentId: string, segments: string[]) {
  let id = parentId;
  for (const name of segments) id = (await findOrCreate(token, id, name)).folderId;
  return id;
}

/**
 * Opens a resumable upload and returns its session URL, which the browser then
 * PUTs the file to directly - media never passes through our server. Sending
 * the page's Origin here is what lets that browser request through CORS.
 */
export async function startUpload(
  token: string,
  file: { parentId: string; name: string; mimeType: string; size: number; origin: string },
): Promise<string> {
  const res = await fetch(
    `${UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id,name`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": file.mimeType || "application/octet-stream",
        "x-upload-content-length": String(file.size),
        origin: file.origin,
      },
      body: JSON.stringify({ name: file.name, parents: [file.parentId] }),
    },
  );
  const location = res.headers.get("location");
  if (!res.ok || !location) throw new Error(await driveError(res));
  return location;
}

export interface DriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  size: number | null;
  modifiedTime: string;
  url: string;
}

/** What is directly inside a folder, folders first, newest first. */
export async function listFolder(token: string, folderId: string): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(
      `${DRIVE_URL}?${new URLSearchParams({
        q: `'${escape(folderId)}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
        orderBy: "folder,modifiedTime desc",
        pageSize: "200",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      })}`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(await driveError(res));
    const body = (await res.json()) as {
      nextPageToken?: string;
      files?: {
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime: string;
        webViewLink?: string;
      }[];
    };
    for (const f of body.files ?? []) {
      const isFolder = f.mimeType === FOLDER_MIME;
      items.push({
        id: f.id,
        name: f.name,
        isFolder,
        size: f.size ? Number(f.size) : null,
        modifiedTime: f.modifiedTime,
        url: isFolder ? folderUrl(f.id) : (f.webViewLink ?? folderUrl(folderId)),
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken && items.length < 1000);
  return items;
}
