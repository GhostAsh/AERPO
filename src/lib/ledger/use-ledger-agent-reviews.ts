import { useEffect, useId, useState } from "react";
import { supabase } from "@/lib/supabase/browser";

export type LedgerAgentReview = {
  id: number;
  ledger_id: number | null;
  timestamp: string | null;
  hypothesis: string | null;
  falsification_test: string | null;
  confidence_score: string | number | null;
  step_executed: string | null;
};

export function useLedgerAgentReviews(
  ledgerIdsKey: string,
  refreshVersion: number,
) {
  const channelId = useId();
  const [reviews, setReviews] = useState<Record<number, LedgerAgentReview>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    let loading = false;
    setStatus("loading");

    async function loadReviews() {
      if (loading) return;
      loading = true;

      try {
        let remainingIds = ledgerIdsKey.split(",").filter(Boolean).map(Number);
        const latest: Record<number, LedgerAgentReview> = {};

        // Remove ledgers already found so a long history cannot hide another
        // ledger's latest review behind the database response row limit.
        while (remainingIds.length > 0) {
          const { data, error } = await supabase
            .from("agent_telemetry")
            .select(
              "id, ledger_id, timestamp, hypothesis, falsification_test, confidence_score, step_executed",
            )
            .in("ledger_id", remainingIds)
            .order("timestamp", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false })
            .limit(1000);

          if (!active) return;
          if (error) throw error;
          if (!data?.length) break;

          for (const review of data as LedgerAgentReview[]) {
            if (review.ledger_id !== null && !latest[review.ledger_id]) {
              latest[review.ledger_id] = review;
            }
          }
          remainingIds = remainingIds.filter((id) => !latest[id]);
        }

        if (active) {
          setReviews(latest);
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("error");
      } finally {
        loading = false;
      }
    }

    void loadReviews();
    const interval = window.setInterval(loadReviews, 10000);
    const channel = supabase
      .channel(`ledger-agent-reviews-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_telemetry" },
        loadReviews,
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [channelId, ledgerIdsKey, refreshVersion]);

  return { reviews, status };
}
