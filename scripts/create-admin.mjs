#!/usr/bin/env node
/**
 * Creates the first Super Admin (or promotes an existing account to one).
 *
 *   npm run create-admin -- --email you@synovative.in --name "Your Name" --password "a-strong-password"
 *
 * Options
 *   --email          Required. Becomes the login ID.
 *   --name           Required. Full name shown in the app.
 *   --password       Required for a new login (at least 8 characters).
 *   --department     Defaults to "Project Managers".
 *   --reset-password Also set --password on a login that already exists.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Run the migrations in supabase/migrations first.
 */
import { createClient } from "@supabase/supabase-js";

const DEPARTMENTS = [
  "Graphic Designers",
  "Videographers / Video Editors / Motion Graphics",
  "Social Media Marketing",
  "Project Managers",
  "Performance Marketers",
  "3D Artists",
  "Website Developers",
  "Business Development Executives",
  "Inside Sales Executives",
  "Accounts & Finance",
  "Human Resources & Admin",
  "Content Writers / Copywriters / Brand Strategists",
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function die(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
const name = typeof args.name === "string" ? args.name.trim() : "";
const password = typeof args.password === "string" ? args.password : "";
const department = typeof args.department === "string" ? args.department : "Project Managers";

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die("Pass a valid --email.");
if (!name) die('Pass --name "Full Name".');
if (!DEPARTMENTS.includes(department)) {
  die(`Unknown --department. Use one of:\n    ${DEPARTMENTS.join("\n    ")}`);
}
if (password && password.length < 8) die("--password must be at least 8 characters.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fail early, with a useful message, if the schema isn't there yet.
const probe = await admin.from("profiles").select("id").limit(1);
if (probe.error) {
  die(
    `Can't read the profiles table (${probe.error.message}).\n` +
      "    Run supabase/migrations/0001 → 0006 in order first (see README).",
  );
}

async function findLogin() {
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

let login = await findLogin();
if (login) {
  console.log(`  • ${email} already has a login — linking it.`);
  if (args["reset-password"]) {
    if (!password) die("--reset-password needs --password.");
    const { error } = await admin.auth.admin.updateUserById(login.id, { password });
    if (error) die(`Couldn't set the password: ${error.message}`);
    console.log("  • Password updated.");
  }
} else {
  if (!password) die("This email has no login yet — pass --password to create one.");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) die(`Couldn't create the login: ${error?.message}`);
  login = data.user;
  console.log(`  • Login created for ${email}.`);
}

const profile = await admin.from("profiles").upsert({
  id: login.id,
  full_name: name,
  email,
  role: "super_admin",
  active: true,
  must_change_password: false,
});
if (profile.error) die(`Couldn't save the profile: ${profile.error.message}`);

const cleared = await admin.from("profile_departments").delete().eq("profile_id", login.id);
if (cleared.error) die(cleared.error.message);
const dept = await admin.from("profile_departments").insert({ profile_id: login.id, department });
if (dept.error) die(dept.error.message);

console.log(`\n  ✔ ${name} <${email}> is a Super Admin. Sign in at /login.\n`);
