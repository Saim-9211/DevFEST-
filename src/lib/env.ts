// Supabase settings.
//
// NEXT_PUBLIC_* values are inlined by Next.js at BUILD time. If they were added in Vercel after a
// build (or only for another environment), that build sees them as empty. On the server we therefore
// also read non-public names at RUNTIME (the names Vercel's Supabase integration sets too), so the
// app works without waiting for a rebuild. Empty strings are treated as "not set".

const first = (...values: (string | undefined)[]) => values.map((v) => v?.trim()).find((v) => Boolean(v)) ?? "";

export const SUPABASE_URL = first(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL);

// Newer projects issue a "publishable" key, older ones an "anon" key; either works.
export const SUPABASE_ANON_KEY = first(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  process.env.SUPABASE_ANON_KEY,
);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Which settings are missing (server-side diagnostics; never includes values). */
export function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}
