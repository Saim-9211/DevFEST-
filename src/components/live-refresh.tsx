"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the page when rows change in the given tables (Supabase Realtime).
 * RLS still applies to what the page reads; this only triggers a refresh.
 * Requires the tables to be in the `supabase_realtime` publication (see migrations).
 */
export function LiveRefresh({
  channel,
  tables,
  filter,
  supabaseUrl,
  supabaseKey,
}: {
  channel: string;
  tables: string[];
  filter?: string;
  supabaseUrl: string;
  supabaseKey: string;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return;
    const supabase = createClient(supabaseUrl, supabaseKey);
    let ch = supabase.channel(channel);
    for (const table of tables) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => router.refresh());
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channel, tables, filter, router, supabaseUrl, supabaseKey]);
  return null;
}
