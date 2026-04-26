import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to Supabase Realtime changes on `expert_signals` and invalidates
 * cached signal/journal queries so /app screens immediately reflect new
 * publications, edits, or recalls without polling.
 *
 * Mount once near the authenticated app shell.
 */
export function useSignalRealtimeInvalidation(enabled: boolean = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel("app-signal-cache")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expert_signals" },
        (payload) => {
          // Invalidate list views (will refetch lazily next time they're used)
          qc.invalidateQueries({ queryKey: ["app-signals"] });
          qc.invalidateQueries({ queryKey: ["app-journals"] });

          // Targeted invalidation for the affected detail page, if any
          const row =
            (payload.new as { id?: string } | null) ??
            (payload.old as { id?: string } | null);
          if (row?.id) {
            qc.invalidateQueries({ queryKey: ["app-signal-detail", row.id] });
            qc.invalidateQueries({ queryKey: ["app-journal-detail", row.id] });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, enabled]);
}
