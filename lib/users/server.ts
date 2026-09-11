import "server-only";

import type { SupabaseClient, User as AuthUser } from "@supabase/supabase-js";
import { DEPARTMENTS } from "@/lib/master-data";
import type { Role } from "@/lib/types";
import type { Caller } from "@/lib/supabase/route-auth";

/** Roles allowed to manage accounts (§6). */
export const USER_MANAGERS: Role[] = ["super_admin", "admin", "hr_admin"];

export const MIN_PASSWORD = 8;

const ASSIGNABLE: Role[] = ["admin", "manager", "hr_admin", "team_leader", "team_member"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** §4.2 — only a Super Admin grants or removes Admin; nobody grants Super Admin here. */
export function roleError(caller: Caller, role: unknown, previous?: Role): string | null {
  if (typeof role !== "string" || !ASSIGNABLE.includes(role as Role)) return "Pick a valid role.";
  const touchesAdmin = role === "admin" || previous === "admin";
  if (touchesAdmin && role !== previous && caller.role !== "super_admin") {
    return "Only a Super Admin can grant or remove the Admin role.";
  }
  return null;
}

/** Departments must come from §5.1; only a Team Leader may have several. */
export function normaliseDepartments(role: Role, departments: unknown): string[] | string {
  if (!Array.isArray(departments) || departments.length === 0) {
    return "Pick at least one department.";
  }
  const valid = departments.filter(
    (d): d is string => typeof d === "string" && (DEPARTMENTS as readonly string[]).includes(d),
  );
  if (valid.length !== departments.length) return "Unknown department.";
  const unique = Array.from(new Set(valid));
  return role === "team_leader" ? unique : unique.slice(0, 1);
}

export function emailError(email: unknown): string | null {
  return typeof email === "string" && EMAIL.test(email.trim()) ? null : "Enter a valid email address.";
}

export function passwordError(password: unknown): string | null {
  return typeof password === "string" && password.length >= MIN_PASSWORD
    ? null
    : `Passwords need at least ${MIN_PASSWORD} characters.`;
}

/**
 * Auth accounts are per Supabase project, so someone may already have a login
 * from another app in the same project. Look them up by email.
 */
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<AuthUser | null> {
  const perPage = 200;
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

export async function replaceDepartments(
  admin: SupabaseClient,
  profileId: string,
  departments: string[],
) {
  const del = await admin.from("profile_departments").delete().eq("profile_id", profileId);
  if (del.error) throw del.error;
  const ins = await admin
    .from("profile_departments")
    .insert(departments.map((department) => ({ profile_id: profileId, department })));
  if (ins.error) throw ins.error;
}
