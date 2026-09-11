/**
 * Public Supabase settings. NEXT_PUBLIC_* values are inlined at build time, so
 * they must be read as literal `process.env.NAME` expressions.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** False until .env.local is filled in — the app then shows setup steps. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
