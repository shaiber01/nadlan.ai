/**
 * Supabase project used by the Hadarim prototype — local development and the hosted site share it.
 * The publishable key is designed to be shipped in the client (access is governed by RLS policies);
 * the secret/service key must never be committed. Override with env vars when pointing elsewhere.
 */
const env = (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: Record<string, string | undefined> }).env) || {};
const nodeEnv = typeof process !== "undefined" ? process.env : {};

export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? nodeEnv.SUPABASE_URL ?? "https://aevdlzncwkdosbzkgpgy.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY: string = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? nodeEnv.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_jPZXyNo6kT5hbZ8mENL1UQ_ISnolx_q";

/** The one project loaded today; more projects are new rows, selected by this id. */
export const DEFAULT_PROJECT_ID = "HADARIM";
