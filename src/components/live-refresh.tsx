"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the page when rows change in the given tables (Supabase Realtime).
 * RLS still applies to what the page reads; this only triggers a refresh.
 * Requires the tables to be in the `supabase_realtime` publication (see migrations).
 */
export function LiveRefresh({ channel, tables, filter }: { channel: string; tables: string[]; filter?: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let ch = supabase.channel(channel);
    for (const table of tables) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => router.refresh());
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channel, tables, filter, router]);
  return null;
}
