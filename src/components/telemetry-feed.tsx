"use client";

import { useEffect, useMemo, useState } from "react";
import { TelemetryGridSkeleton } from "@/components/loading-skeletons";
import { supabase } from "@/lib/supabase/browser";

type AgentTelemetryRow = {
  id: number;
  ledger_id: number | null;
  timestamp: string | null;
  hypothesis: string | null;
  falsification_test: string | null;
  confidence_score: string | number | null;
  step_executed: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

// Streams model telemetry so users can inspect the optimizer's reasoning trail.
export function TelemetryFeed() {
  const [rows, setRows] = useState<AgentTelemetryRow[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTelemetry() {
      const { data, error } = await supabase
        .from("agent_telemetry")
        .select(
          "id, ledger_id, timestamp, hypothesis, falsification_test, confidence_score, step_executed",
        )
        .order("timestamp", { ascending: false })
        .limit(9);

      if (!isMounted) {
        return;
      }

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      setRows(data ?? []);
      setStatus("live");
    }

    loadTelemetry();

    const channel = supabase
      .channel("agent-telemetry-feed")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_telemetry",
        },
        (payload) => {
          const nextRow = payload.new as AgentTelemetryRow;
          setRows((currentRows) => [nextRow, ...currentRows].slice(0, 9));
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
      supabase.removeChannel(channel);
    };
  }, []);

  const statusLabel = useMemo(() => {
    if (status === "loading") {
      return "loading";
    }

    if (status === "error") {
      return "needs attention";
    }

    return "websocket-ready";
  }, [status]);

  return (
    <section className="rounded-lg border border-[#c8d3d1] bg-[#102522] p-5 text-white shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Live Logic Telemetry</h2>
          <p className="mt-1 text-sm text-[#b8c8c5]">
            Mirrors the public.agent_telemetry audit trail.
          </p>
        </div>
        <span className="w-fit rounded-full border border-teal-300/40 bg-teal-300/10 px-3 py-1 text-xs font-semibold text-teal-100">
          {statusLabel}
        </span>
      </div>

      {status === "error" ? (
        <div className="mt-5 rounded-lg border border-rose-300/30 bg-rose-300/10 p-4 text-sm text-rose-100">
          {errorMessage ?? "Telemetry could not be loaded."}
        </div>
      ) : null}

      {status === "loading" ? (
        <TelemetryGridSkeleton />
      ) : null}

      {status === "live" && rows.length === 0 ? (
        <div className="mt-5 rounded-lg border border-white/12 bg-white/[0.06] p-4 text-sm text-[#d3dddb]">
          No telemetry rows yet. Run the smoke model script to create the first
          reasoning event.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {rows.map((row) => (
          <TelemetryCard key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

// Renders one persisted model reasoning step from agent_telemetry.
function TelemetryCard({ row }: { row: AgentTelemetryRow }) {
  const confidence = Number(row.confidence_score ?? 0);
  const timestamp = row.timestamp ? new Date(row.timestamp) : null;
  const timestampLabel = timestamp ? dateFormatter.format(timestamp) : "pending";

  return (
    <article className="rounded-lg border border-white/12 bg-white/[0.06] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-[#b8c8c5]">
          {row.ledger_id ? `ledger #${row.ledger_id}` : `telemetry #${row.id}`}
        </p>
        <p className="text-xs text-[#b8c8c5]">{timestampLabel}</p>
      </div>
      <p className="mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-teal-200">
        Hypothesis
      </p>
      <p className="mt-1 text-sm font-semibold leading-6 text-white">
        {row.hypothesis ?? "No hypothesis recorded."}
      </p>
      <p className="mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#9eb2ae]">
        Falsification test
      </p>
      <p className="mt-1 text-sm leading-6 text-[#d3dddb]">
        {row.falsification_test ?? "No falsification test recorded."}
      </p>
      <div className="mt-4 flex items-center justify-between gap-4">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[#e8f0ee]">
          {row.step_executed ?? "step_pending"}
        </span>
        <span className="text-sm font-semibold text-teal-200">
          {Math.round(confidence * 100)}%
        </span>
      </div>
    </article>
  );
}
