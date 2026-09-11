import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";
import type { Role } from "@/lib/types";
import {
  USER_MANAGERS,
  emailError,
  findAuthUserByEmail,
  normaliseDepartments,
  passwordError,
  replaceDepartments,
  roleError,
} from "@/lib/users/server";

/**
 * §6 — add a user. Super Admin, Admin and HR Admin only. Creates the Supabase
 * Auth login and the PMS profile together. If the email already has a login in
 * this Supabase project (another app sharing it), PMS access is attached to
 * that login and its password is left alone.
 */
export async function POST(request: NextRequest) {
  const caller = await requireCaller(USER_MANAGERS);
  if (caller instanceof NextResponse) return caller;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(400, "Invalid request.");

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!fullName) return fail(400, "A full name is required.");
  const invalid =
    emailError(email) ?? roleError(caller, body.role) ?? passwordError(body.password);
  if (invalid) return fail(400, invalid);

  const role = body.role as Role;
  const departments = normaliseDepartments(role, body.departments);
  if (typeof departments === "string") return fail(400, departments);

  const admin = getAdminSupabase();

  const existingProfile = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingProfile.data) return fail(409, "That email already has a PMS account.");

  let userId: string;
  let createdLogin = false;
  const created = await admin.auth.admin.createUser({
    email,
    password: body.password as string,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.data.user) {
    userId = created.data.user.id;
    createdLogin = true;
  } else {
    const existing = await findAuthUserByEmail(admin, email).catch(() => null);
    if (!existing) return fail(400, created.error?.message ?? "Couldn't create the login.");
    userId = existing.id;
  }

  const profile = await admin.from("profiles").insert({
    id: userId,
    full_name: fullName,
    email,
    role,
    active: true,
    // A shared login keeps its own password, so there's nothing to change.
    must_change_password: createdLogin,
  });
  if (profile.error) {
    if (createdLogin) await admin.auth.admin.deleteUser(userId);
    return fail(400, profile.error.message);
  }

  try {
    await replaceDepartments(admin, userId, departments);
  } catch (err) {
    await admin.from("profiles").delete().eq("id", userId);
    if (createdLogin) await admin.auth.admin.deleteUser(userId);
    return fail(400, (err as Error).message);
  }

  return NextResponse.json({ id: userId, linkedExistingLogin: !createdLogin }, { status: 201 });
}
