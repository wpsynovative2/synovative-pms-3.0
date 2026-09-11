import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";

/** Where bills land in the Cloudinary media library. */
const FOLDER = "synovative-pms/expenses";

/**
 * §8 — signs a direct browser→Cloudinary upload for an expense bill. The API
 * secret never leaves the server; the browser only gets a short-lived signature
 * for this folder. Any active PMS member may upload (the expense itself is
 * still guarded by RLS).
 */
export async function POST() {
  const caller = await requireCaller();
  if (caller instanceof NextResponse) return caller;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return fail(503, "File uploads aren't set up yet (Cloudinary keys are missing).");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  // Cloudinary signs the alphabetically sorted params, then appends the secret.
  const signature = createHash("sha1")
    .update(`folder=${FOLDER}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  return NextResponse.json({ cloudName, apiKey, timestamp, signature, folder: FOLDER });
}
