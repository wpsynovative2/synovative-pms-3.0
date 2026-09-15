import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/server";
import { fail, requireCaller } from "@/lib/supabase/route-auth";
import { outranksAccount } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import {
  USER_MANAGERS,
  emailError,
  normaliseDepartments,
  passwordError,
  replaceDepartments,
  roleError,
} from "@/lib/users/server";

/**
 * §6 — edit a user: name, email, role, departments, active, or reset password.
 * Super Admin, Admin and HR Admin, each only for accounts at or below their own
 * level: an Admin account takes an Admin, a Super Admin account a Super Admin.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const caller = await requireCaller(USER_MANAGERS);
  if (caller instanceof NextResponse) return caller;
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(400, "Invalid request.");

  const admin = getAdminSupabase();
  const { data: target } = await admin
    .from("profiles")
    .select("id, role, email")
    .eq("id", id)
    .maybeSingle();
  if (!target) return fail(404, "That user no longer exists.");

  const previous = target.role as Role;
  if (!outranksAccount(caller.role, previous)) {
    return fail(
      403,
      previous === "super_admin"
        ? "Only a Super Admin can change a Super Admin account."
        : "Only a Super Admin or an Admin can change an Admin account.",
    );
  }

  const profile: Record<string, unknown> = {};

  if ("fullName" in body) {
    const name = typeof body.fullName === "string" ? body.fullName.trim() : "";
    if (!name) return fail(400, "A full name is required.");
    profile.full_name = name;
  }

  let role = previous;
  if ("role" in body && body.role !== previous) {
    if (id === caller.id) return fail(400, "You can't change your own role.");
    const invalid = roleError(caller, body.role, previous);
    if (invalid) return fail(400, invalid);
    role = body.role as Role;
    profile.role = role;
  }

  if ("active" in body) {
    if (typeof body.active !== "boolean") return fail(400, "Invalid active flag.");
    if (id === caller.id && !body.active) return fail(400, "You can't deactivate yourself.");
    // Access ends through RLS and the app's sign-in check. The Supabase login
    // itself is not banned, as it may be shared with another app.
    profile.active = body.active;
  }

  const auth: { email?: string; password?: string; email_confirm?: boolean } = {};
  if ("email" in body) {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const invalid = emailError(email);
    if (invalid) return fail(400, invalid);
    if (email !== target.email) {
      auth.email = email;
      auth.email_confirm = true;
      profile.email = email;
    }
  }
  if ("password" in body && body.password) {
    const invalid = passwordError(body.password);
    if (invalid) return fail(400, invalid);
    auth.password = body.password as string;
    profile.must_change_password = true;
  }

  let departments: string[] | null = null;
  if ("departments" in body || profile.role) {
    const next = normaliseDepartments(role, body.departments ?? (await currentDepartments(admin, id)));
    if (typeof next === "string") return fail(400, next);
    departments = next;
  }

  if (Object.keys(auth).length) {
    const res = await admin.auth.admin.updateUserById(id, auth);
    if (res.error) return fail(400, res.error.message);
  }
  if (Object.keys(profile).length) {
    const res = await admin.from("profiles").update(profile).eq("id", id);
    if (res.error) return fail(400, res.error.message);
  }
  if (departments) {
    try {
      await replaceDepartments(admin, id, departments);
    } catch (err) {
      return fail(400, (err as Error).message);
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * §4.2 — delete a user: Super Admin only. Removes the PMS account; refuses when
 * the person has work history (deactivate instead, §6). The Supabase login is
 * kept because it may belong to another app in the same project too.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">) {
  const caller = await requireCaller(["super_admin"]);
  if (caller instanceof NextResponse) return caller;
  const { id } = await ctx.params;
  if (id === caller.id) return fail(400, "You can't delete your own account.");

  const admin = getAdminSupabase();
  const res = await admin.from("profiles").delete().eq("id", id);
  if (res.error) {
    if (res.error.code === "23503") {
      return fail(
        409,
        "This person has tasks, time logs or reviews on record. Deactivate them instead so the history stays intact.",
      );
    }
    return fail(400, res.error.message);
  }
  return NextResponse.json({ ok: true });
}

async function currentDepartments(
  admin: ReturnType<typeof getAdminSupabase>,
  id: string,
): Promise<string[]> {
  const { data } = await admin.from("profile_departments").select("department").eq("profile_id", id);
  return (data ?? []).map((r) => r.department as string);
}
