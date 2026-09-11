"use client";

export interface UploadedFile {
  name: string;
  url: string;
}

/** Largest bill we accept — Cloudinary's free plan caps raw files at 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Uploads an expense bill straight to Cloudinary using a signature from
 * /api/uploads/sign, and returns its permanent `secure_url` (§2, §8).
 */
export async function uploadBill(file: File): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is over 10 MB.");

  const signRes = await fetch("/api/uploads/sign", { method: "POST" });
  const sign = (await signRes.json().catch(() => ({}))) as {
    error?: string;
    cloudName: string;
    apiKey: string;
    timestamp: number;
    signature: string;
    folder: string;
  };
  if (!signRes.ok) throw new Error(sign.error ?? "Couldn't start the upload.");

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sign.apiKey);
  form.append("timestamp", String(sign.timestamp));
  form.append("signature", sign.signature);
  form.append("folder", sign.folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/auto/upload`, {
    method: "POST",
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as {
    secure_url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.secure_url) {
    throw new Error(json.error?.message ?? "The upload failed.");
  }
  return { name: file.name, url: json.secure_url };
}
