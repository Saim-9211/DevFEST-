import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Supabase client for Client Components (Realtime subscriptions, etc.).
 * Pass the URL/key from a Server Component when possible: NEXT_PUBLIC_* values are only
 * available in the browser if they were set when the app was built.
 */
export function createClient(url = SUPABASE_URL, anonKey = SUPABASE_ANON_KEY) {
  return createBrowserClient(url, anonKey);
}
