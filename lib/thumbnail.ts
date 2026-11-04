"use client";

/**
 * A 3D task's thumbnail (0026). The browser shrinks the image and sends it straight
 * to Google, so only the small copy is ever stored and nothing large passes through
 * our server. The server only opens the upload (/api/drive/thumbnails).
 */

/** Past this a phone photo or a render is being picked by mistake. */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
/** The longest side, in pixels: sharp in a panel, small on Drive. */
const MAX_SIDE = 1600;
/** Quality steps down until the image is under the target size. */
const QUALITIES = [0.8, 0.65, 0.5];
const TARGET_BYTES = 1024 * 1024;

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("That image couldn't be compressed."))),
      "image/jpeg",
      quality,
    ),
  );

/** Always a JPEG, whatever was picked. Any transparency lands on white. */
export async function compressThumbnail(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is over 50 MB.");

  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode().catch(() => {
      throw new Error("That image couldn't be read. Try a JPG or PNG.");
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That image couldn't be compressed.");
    // Image data rather than a UI colour: JPEG has no transparency to keep.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    let blob = await toJpeg(canvas, QUALITIES[0]);
    for (const quality of QUALITIES.slice(1)) {
      if (blob.size <= TARGET_BYTES) break;
      blob = await toJpeg(canvas, quality);
    }
    return blob;
  } finally {
    URL.revokeObjectURL(source);
  }
}

export interface UploadedThumbnail {
  fileId: string;
  url: string;
}

/** Puts a compressed thumbnail in the master folder on Drive. */
export async function uploadThumbnail(
  projectId: string,
  taskTitle: string,
  thumbnailName: string,
  image: Blob,
): Promise<UploadedThumbnail> {
  const res = await fetch("/api/drive/thumbnails", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, taskTitle, thumbnailName, size: image.size }),
  });
  const opened = (await res.json().catch(() => null)) as {
    uploadUrl?: string;
    error?: string;
  } | null;
  if (!res.ok || !opened?.uploadUrl) {
    throw new Error(opened?.error ?? "Couldn't start the upload.");
  }

  const put = await fetch(opened.uploadUrl, {
    method: "PUT",
    // Must match the type the session was opened with.
    headers: { "content-type": "image/jpeg" },
    body: image,
  }).catch(() => {
    throw new Error("The upload was interrupted.");
  });
  if (!put.ok) throw new Error(`Google Drive returned ${put.status}.`);
  const { id } = (await put.json()) as { id?: string };
  if (!id) throw new Error("Google Drive didn't say where the image went.");
  return { fileId: id, url: `https://drive.google.com/file/d/${id}/view` };
}

/** Gives the file on Drive the name typed for it. */
export async function renameThumbnail(fileId: string, projectId: string, name: string) {
  const res = await fetch(`/api/drive/thumbnails/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, name }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't rename the thumbnail on Drive.");
  }
}

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("That image couldn't be read."));
    reader.readAsDataURL(blob);
  });

/** "210 KB", "1.4 MB". */
export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
