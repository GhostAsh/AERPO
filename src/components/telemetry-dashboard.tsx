"use client";

import { useEffect, useMemo, useState } from "react";
import { LedgerDetailModal } from "@/components/ledger-detail-modal";
import { MetricGridSkeleton, TableSkeleton } from "@/components/loading-skeletons";
import { ColumnFilter, FilterSummary } from "@/components/table-column-filters";
import { matchesColumnFilters, type ColumnFilters, type FilterColumn } from "@/lib/table-filters";
import { useLedgerRows } from "@/lib/ledger/use-ledger-rows";
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

const filters = [
  { label: "All work", value: "all" },
  { label: "Corrections", value: "create_correction_candidate" },
  { label: "Human review", value: "request_human_review" },
  { label: "Finalize", value: "finalize_ledger" },
  { label: "Evidence", value: "gather_evidence" },
  { label: "Duplicates", value: "mark_duplicate" },
] as const;

type FilterValue = (typeof filters)[number]["value"];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function TelemetryDashboard() {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const updateFilter = (key: string, value: string) => setColumnFilters((current) => ({ ...current, [key]: value }));
  const { rows: ledgerRows } = useLedgerRows(250);
  const [rows, setRows] = useState<AgentTelemetryRow[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");
  const [selectedLedgerId, setSelectedLedgerId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTelemetry() {
      const { data, error } = await supabase
        .from("agent_telemetry")
        .select(
          "id, ledger_id, timestamp, hypothesis, falsification_test, confidence_score, step_executed",
        )
        .order("timestamp", { ascending: false })
        .limit(60);

      if (!isMounted) {
        return;
      }

      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      const nextRows = data ?? [];
      setRows(nextRows);
      setStatus("live");
    }

    loadTelemetry();

    const channel = supabase
      .channel("agent-telemetry-dashboard")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_telemetry",
        },
        (payload) => {
          const nextRow = payload.new as AgentTelemetryRow;
          setRows((currentRows) => [nextRow, ...currentRows].slice(0, 60));
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

  const telemetryFilterColumns = useMemo<FilterColumn[]>(() => [
    { key: "ledger", label: "Telemetry ledger or event ID" },
    { key: "time", label: "Event date", type: "date" },
    { key: "logic", label: "Logic assessment" },
    { key: "step", label: "Telemetry step", options: [...new Set(rows.map((row) => row.step_executed ?? "step_pending"))].sort().map((value) => ({ value, label: value.replaceAll("_", " ") })) },
    { key: "confidence", label: "Confidence (%)", type: "number" },
  ], [rows]);
  const filteredRows = useMemo(() => rows.filter((row) =>
    (activeFilter === "all" || row.step_executed === activeFilter) &&
    matchesColumnFilters({
      ledger: formatLedger(row), time: row.timestamp,
      logic: `${row.hypothesis ?? "No hypothesis recorded"} ${row.falsification_test ?? "No falsification test recorded"}`,
      step: row.step_executed ?? "step_pending", confidence: Math.round(getConfidence(row) * 100),
    }, columnFilters, telemetryFilterColumns)
  ), [activeFilter, rows, columnFilters, telemetryFilterColumns]);

  const metrics = useMemo(() => {
    const ledgerIds = new Set(
      rows
        .map((row) => row.ledger_id)
        .filter((ledgerId): ledgerId is number => typeof ledgerId === "number"),
    );
    const confidenceValues = rows.map(getConfidence);
    const averageConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((total, score) => total + score, 0) /
          confidenceValues.length
        : 0;
    const humanReviewCount = rows.filter(
      (row) => row.step_executed === "request_human_review",
    ).length;

    return {
      events: rows.length,
      ledgers: ledgerIds.size,
      averageConfidence,
      humanReviewCount,
    };
  }, [rows]);

  const selectedLedger = useMemo(() => {
    if (selectedLedgerId === null) {
      return null;
    }

    return ledgerRows.find((row) => row.id === selectedLedgerId) ?? null;
  }, [ledgerRows, selectedLedgerId]);

  const totalExposure = useMemo(() => {
    return ledgerRows.reduce(
      (sum, row) => sum + Math.abs(Number(row.amount ?? 0)),
      0,
    );
  }, [ledgerRows]);

  const statusLabel =
    status === "loading"
      ? "loading"
      : status === "error"
        ? "needs attention"
        : "websocket-ready";

  return (
    <section className="rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
      <div className="min-w-0">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-[#102522]">
              Agent telemetry stream
            </h2>
            <p className="mt-1 text-sm text-[#63716f]">
              Mirrors public.agent_telemetry with live insert updates.
            </p>
          </div>
          <span className="w-fit rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
            {statusLabel}
          </span>
        </div>

        {status === "loading" ? (
          <div className="mt-5">
            <MetricGridSkeleton />
          </div>
        ) : (
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricTile label="Events loaded" value={String(metrics.events)} />
            <MetricTile
              label="Ledgers touched"
              value={String(metrics.ledgers)}
            />
            <MetricTile
              label="Avg confidence"
              value={`${Math.round(metrics.averageConfidence * 100)}%`}
            />
            <MetricTile
              label="Human reviews"
              value={String(metrics.humanReviewCount)}
            />
          </div>
        )}

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {filters.map((filter) => {
            const isActive = activeFilter === filter.value;

            return (
              <button
                className={`min-w-fit rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "border-[#102522] bg-[#102522] text-white"
                    : "border-[#dbe3e1] bg-[#f8fbfa] text-[#526260] hover:border-teal-300 hover:text-[#102522]"
                }`}
                key={filter.value}
                onClick={() => setActiveFilter(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        {status === "error" ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {errorMessage ?? "Telemetry could not be loaded."}
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="mt-5 space-y-5">
            <TableSkeleton columns={5} rows={6} />
          </div>
        ) : null}

        {status === "live" && rows.length === 0 ? (
          <div className="mt-5 rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] p-4 text-sm text-[#63716f]">
            No telemetry rows yet. Run the optimizer to create the first audit
            event.
          </div>
        ) : null}

        {status === "live" && rows.length > 0 ? (
          <FilterSummary shown={filteredRows.length} total={rows.length} active={activeFilter !== "all" || Object.values(columnFilters).some(Boolean)} onClear={() => { setColumnFilters({}); setActiveFilter("all"); }} />
        ) : null}

        {status === "live" && rows.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-lg border border-[#dbe3e1]">
            <div role="group" aria-label="Telemetry column filters" className="grid gap-3 border-b border-[#dbe3e1] bg-[#f8fbfa] p-3 sm:grid-cols-2 lg:hidden">
              {telemetryFilterColumns.map((column) => <div key={column.key} className="min-w-0 text-xs text-[#63716f]"><span className="mb-1 block">{column.label}</span><ColumnFilter column={column} values={columnFilters} onChange={updateFilter} /></div>)}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[58rem] border-collapse text-center text-sm">
                <thead className="bg-[#102522] text-xs uppercase tracking-[0.18em] text-white">
                  <tr className="[&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-white/15">
                    <th className="px-4 py-3 font-semibold">Ledger</th>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Logic assessment</th>
                    <th className="px-4 py-3 font-semibold">Step</th>
                    <th className="px-4 py-3 font-semibold">Confidence</th>
                  </tr>
                  <tr className="border-b border-[#dbe3e1] bg-[#f8fbfa] [&>td]:px-3 [&>td]:py-2">
                    {telemetryFilterColumns.map((column) => <td key={column.key}><ColumnFilter column={column} values={columnFilters} onChange={updateFilter} /></td>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#dbe3e1]">
                  {filteredRows.map((row) => (
                    <TelemetryTableRow
                      key={row.id}
                      onOpenLedger={setSelectedLedgerId}
                      row={row}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[#dbe3e1] lg:hidden">
              {filteredRows.map((row) => (
                <button
                  className="block w-full bg-white p-4 text-left transition hover:bg-[#f8fbfa] disabled:cursor-default disabled:hover:bg-white"
                  disabled={row.ledger_id === null}
                  key={row.id}
                  onClick={() => {
                    if (row.ledger_id !== null) {
                      setSelectedLedgerId(row.ledger_id);
                    }
                  }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs font-semibold text-[#526260]">
                      {formatLedger(row)}
                    </p>
                    <p className="text-xs text-[#63716f]">{formatTime(row)}</p>
                  </div>
                  <p className="mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-teal-700">
                    Hypothesis
                  </p>
                  <p className="mt-1 font-semibold text-[#102522]">
                    {row.hypothesis ?? "No hypothesis recorded."}
                  </p>
                  <p className="mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#63716f]">
                    Falsification test
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#63716f]">
                    {row.falsification_test ?? "No falsification test recorded."}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <StepBadge value={row.step_executed} />
                    <ConfidenceMeter value={getConfidence(row)} compact />
                  </div>
                </button>
              ))}
            </div>

            {filteredRows.length === 0 ? (
              <div className="p-4 text-sm text-[#63716f]">
                No telemetry matches this filter yet.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedLedger ? (
        <LedgerDetailModal
          onClose={() => setSelectedLedgerId(null)}
          row={selectedLedger}
          totalExposure={totalExposure}
        />
      ) : null}
    </section>
  );
}

function TelemetryTableRow({
  onOpenLedger,
  row,
}: {
  onOpenLedger: (ledgerId: number) => void;
  row: AgentTelemetryRow;
}) {
  const canOpenLedger = row.ledger_id !== null;

  return (
    <tr
      className={`bg-white transition [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#e2e8e6] ${
        canOpenLedger ? "cursor-pointer hover:bg-[#f8fbfa]" : ""
      }`}
      onClick={() => {
        const ledgerId = row.ledger_id;

        if (ledgerId !== null) {
          onOpenLedger(ledgerId);
        }
      }}
    >
      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs font-semibold text-[#526260]">
        {formatLedger(row)}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-[#526260]">
        {formatTime(row)}
      </td>
      <td className="max-w-[28rem] px-4 py-4 text-center">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-teal-700">
          Hypothesis
        </p>
        <p className="font-semibold text-[#102522]">
          {row.hypothesis ?? "No hypothesis recorded."}
        </p>
        <p className="mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#63716f]">
          Falsification test
        </p>
        <p className="mx-auto mt-1 text-[#63716f]">
          {row.falsification_test ?? "No falsification test recorded."}
        </p>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <StepBadge value={row.step_executed} />
      </td>
      <td className="min-w-40 px-4 py-4">
        <ConfidenceMeter value={getConfidence(row)} />
      </td>
    </tr>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#63716f]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[#102522]">{value}</p>
    </div>
  );
}

function StepBadge({ value }: { value: string | null }) {
  return (
    <span className="inline-flex justify-center rounded-full bg-[#e7efed] px-3 py-1 text-xs font-semibold text-[#526260]">
      {value ?? "step_pending"}
    </span>
  );
}

function ConfidenceMeter({
  compact = false,
  value,
}: {
  compact?: boolean;
  value: number;
}) {
  return (
    <div className={compact ? "mx-auto min-w-24" : "mx-auto min-w-36"}>
      <div className="flex items-center justify-between gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#dbe3e1]">
          <div
            className="h-full rounded-full bg-teal-500"
            style={{ width: `${Math.round(value * 100)}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-[#102522]">
          {Math.round(value * 100)}%
        </span>
      </div>
    </div>
  );
}

function formatLedger(row: AgentTelemetryRow) {
  return row.ledger_id ? `ledger #${row.ledger_id}` : `telemetry #${row.id}`;
}

function formatTime(row: AgentTelemetryRow) {
  return row.timestamp ? dateFormatter.format(new Date(row.timestamp)) : "pending";
}

function getConfidence(row: AgentTelemetryRow) {
  const confidence = Number(row.confidence_score ?? 0);

  if (Number.isNaN(confidence)) {
    return 0;
  }

  return Math.min(Math.max(confidence, 0), 1);
}
