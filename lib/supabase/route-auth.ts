import "server-only";

import { NextResponse } from "next/server";
import type { Role } from "@/lib/types";
import { getServerSupabase } from "./server";

export interface Caller {
  id: string;
  role: Role;
}

/** JSON error response in the shape the client's `callAdmin` expects. */
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Who is calling, from their Supabase session cookie — or an error response.
 * The caller must have an active PMS profile and, when `roles` is given, one
 * of those roles. Server routes use this before touching the service role.
 */
export async function requireCaller(roles?: Role[]): Promise<Caller | NextResponse> {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return fail(401, "Please sign in again.");

  const { data: profile } = await sb
    .from("profiles")
    .select("id, role, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !profile.active) return fail(403, "Your account can't do this.");
  if (roles && !roles.includes(profile.role as Role)) {
    return fail(403, "Your role can't do this.");
  }
  return { id: profile.id as string, role: profile.role as Role };
}
