import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/browser";

export const LEDGER_CREATED_EVENT = "aerpo:ledger-created";

export type ErpLedgerRow = {
  id: number;
  transaction_date: string | null;
  description: string | null;
  amount: string | number | null;
  department: string | null;
  status: string | null;
  optimization_notes: string | null;
};

type LedgerRowsState = {
  rows: ErpLedgerRow[];
  status: "loading" | "live" | "error";
  errorMessage: string | null;
};

const ledgerRefreshIntervalMs = 5000;

// Loads and streams public.erp_ledger rows for dashboard components.
export function useLedgerRows(limit = 100): LedgerRowsState {
  const channelIdRef = useRef(Math.random().toString(36).slice(2));
  const [rows, setRows] = useState<ErpLedgerRow[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let refreshInFlight = false;

    async function loadLedgerRows() {
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;

      const { data, error } = await supabase
        .from("erp_ledger")
        .select(
          "id, transaction_date, description, amount, department, status, optimization_notes",
        )
        .order("transaction_date", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (!isMounted) {
        refreshInFlight = false;
        return;
      }

      if (error) {
        setStatus((currentStatus) =>
          currentStatus === "loading" ? "error" : currentStatus,
        );
        setErrorMessage(error.message);
        refreshInFlight = false;
        return;
      }

      setRows(data ?? []);
      setStatus("live");
      setErrorMessage(null);
      refreshInFlight = false;
    }

    loadLedgerRows();
    const refreshInterval = window.setInterval(
      loadLedgerRows,
      ledgerRefreshIntervalMs,
    );

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        loadLedgerRows();
      }
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);

    function addCreatedLedger(event: Event) {
      const ledger = (event as CustomEvent<ErpLedgerRow>).detail;

      setRows((currentRows) => [
        ledger,
        ...currentRows.filter((row) => row.id !== ledger.id),
      ].slice(0, limit));
      setStatus("live");
      setErrorMessage(null);
    }

    window.addEventListener(LEDGER_CREATED_EVENT, addCreatedLedger);

    const channel = supabase
      .channel(`erp-ledger-rows-${limit}-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "erp_ledger",
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Pick<ErpLedgerRow, "id">;
            setRows((currentRows) =>
              currentRows.filter((row) => row.id !== oldRow.id),
            );
            return;
          }

          const nextRow = payload.new as ErpLedgerRow;
          setRows((currentRows) => {
            const withoutCurrent = currentRows.filter(
              (row) => row.id !== nextRow.id,
            );
            return [nextRow, ...withoutCurrent].slice(0, limit);
          });
          setStatus("live");
        },
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "CHANNEL_ERROR") {
          setStatus("error");
          setErrorMessage("Realtime channel could not connect.");
        }
      });

    return () => {
      isMounted = false;
      window.clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener(LEDGER_CREATED_EVENT, addCreatedLedger);
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { rows, status, errorMessage };
}
