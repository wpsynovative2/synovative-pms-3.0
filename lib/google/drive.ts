import "server-only";

import { createSign } from "node:crypto";

/**
 * The slice of the Google Drive API the Properties module needs: sign in as a
 * service account, then find-or-create a folder under a parent.
 *
 * No SDK. A service-account token is a signed JWT exchanged for an access
 * token, and folder creation is two REST calls — pulling in googleapis for
 * that would cost far more than it saves.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_URL = "https://www.googleapis.com/drive/v3/files";
const SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveConfig {
  clientEmail: string;
  privateKey: string;
  /** The folder the whole "Clients" tree is created inside. */
  parentFolderId: string;
}

/**
 * Reads the service account out of the environment, or returns null when Drive
 * has not been set up. Keys are usually pasted with literal "\n" in them, which
 * is why they are unescaped here.
 */
export function driveConfig(): DriveConfig | null {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  if (!clientEmail || !privateKey || !parentFolderId) return null;
  return { clientEmail, privateKey: privateKey.replace(/\\n/g, "\n"), parentFolderId };
}

const b64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

async function accessToken(config: DriveConfig): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const input = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: config.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(input)
    .sign(config.privateKey, "base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${signature}`,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || "Google refused the service account.");
  }
  return body.access_token;
}

/** Drive's query language has no parameter binding; only quotes need escaping. */
const escape = (name: string) => name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export interface DriveFolderResult {
  name: string;
  folderId: string;
  url: string;
}

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/**
 * Returns the folder of this name under `parentId`, creating it only if it is
 * not already there. That is what makes "Create Directory" safe to press twice.
 */
async function findOrCreate(
  token: string,
  parentId: string,
  name: string,
): Promise<DriveFolderResult> {
  const query = [
    `'${escape(parentId)}' in parents`,
    `name = '${escape(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    "trashed = false",
  ].join(" and ");

  const search = await fetch(
    `${DRIVE_URL}?${new URLSearchParams({
      q: query,
      fields: "files(id,name)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "1",
    })}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!search.ok) throw new Error(await driveError(search));
  const found = (await search.json()) as { files?: { id: string }[] };
  if (found.files?.length) {
    return { name, folderId: found.files[0].id, url: folderUrl(found.files[0].id) };
  }

  const created = await fetch(`${DRIVE_URL}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!created.ok) throw new Error(await driveError(created));
  const { id } = (await created.json()) as { id: string };
  return { name, folderId: id, url: folderUrl(id) };
}

async function driveError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message || `Google Drive returned ${res.status}.`;
}

/**
 * Builds Clients / <company> / <client> / <property> and the media folders
 * inside it, and hands back every folder it touched.
 */
export async function createPropertyTree(
  config: DriveConfig,
  path: { company: string; client: string; property: string },
  mediaFolders: readonly string[],
): Promise<{ folderId: string; url: string; folders: DriveFolderResult[] }> {
  const token = await accessToken(config);

  const clientsRoot = await findOrCreate(token, config.parentFolderId, "Clients");
  const company = await findOrCreate(token, clientsRoot.folderId, path.company);
  const client = await findOrCreate(token, company.folderId, path.client);
  const property = await findOrCreate(token, client.folderId, path.property);

  // Sequential on purpose: Drive rate-limits hard, and three folders is quick.
  const folders: DriveFolderResult[] = [];
  for (const name of mediaFolders) {
    folders.push(await findOrCreate(token, property.folderId, name));
  }

  return { folderId: property.folderId, url: property.url, folders };
}
