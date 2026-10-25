"use client";

import { useMemo, useState } from "react";
import { TableSkeleton } from "@/components/loading-skeletons";
import { readJsonResponse } from "@/lib/http/read-json-response";
import { ErpLedgerRow, useLedgerRows } from "@/lib/ledger/use-ledger-rows";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const fallbackStatusStyle = "border-slate-200 bg-slate-50 text-slate-700";

const statusStyles: Record<string, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  duplicate: "border-slate-300 bg-slate-100 text-slate-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  review: "border-rose-200 bg-rose-50 text-rose-800",
};

// Streams ERP ledger rows into the worklist from public.erp_ledger.
export function LedgerWorklist() {
  const state = useLedgerRows(12);
  return <LedgerWorklistPanel {...state} />;
}

export function LedgerWorklistPanel({ rows, status, errorMessage, compact = false }: {
  rows: ErpLedgerRow[];
  status: "loading" | "live" | "error";
  errorMessage: string | null;
  compact?: boolean;
}) {
  const [optimizerStatus, setOptimizerStatus] = useState<
    "idle" | "running" | "complete" | "error"
  >("idle");
  const [optimizerMessage, setOptimizerMessage] = useState<string | null>(null);

  const statusLabel = useMemo(() => {
    if (status === "loading") {
      return "Loading rows";
    }

    if (status === "error") {
      return "Connection issue";
    }

    return `${rows.length} live rows`;
  }, [rows.length, status]);

  async function runOptimizer() {
    setOptimizerStatus("running");
    setOptimizerMessage("Inspecting ledgers...");

    try {
      const response = await fetch("/api/optimizer/run", {
        method: "POST",
      });
      const result = await readJsonResponse<
        | {
            correction_ids?: number[];
            existing_correction_ids?: number[];
            inspected: number;
            status_update_skipped?: number;
            status_updates?: { ledger_id: number; status: string }[];
            telemetry_ids: number[];
          }
        | { error: string }
      >(response, "Optimizer service returned an unexpected response.");

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Optimizer failed.");
      }

      const statusUpdateCount = result.status_updates?.length ?? 0;
      const correctionCount = result.correction_ids?.length ?? 0;
      const existingCorrectionCount =
        result.existing_correction_ids?.length ?? 0;
      const skippedCount = result.status_update_skipped ?? 0;
      setOptimizerStatus("complete");
      setOptimizerMessage(
        `Inspected ${result.inspected} rows, queued ${correctionCount} corrections, reused ${existingCorrectionCount} pending corrections, updated ${statusUpdateCount} statuses, skipped ${skippedCount}.`,
      );
    } catch (error) {
      setOptimizerStatus("error");
      setOptimizerMessage(
        error instanceof Error ? error.message : "Optimizer failed.",
      );
    }
  }

  return (
    <div className={compact ? "scorecard-panel flex h-[340px] min-w-0 flex-col" : "flex h-[430px] flex-col rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm"}>
      <div className="shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className={compact ? "text-sm font-semibold" : "text-xl font-semibold text-[#102522]"}>
            Ledger Worklist
          </h2>
          <p className="mt-1 text-xs text-[#63716f]">
            {compact ? "Latest entries in the selected range" : "Mirrors the public.erp_ledger approval surface."}
          </p>
        </div>
        <button
          className={compact ? "scorecard-control shrink-0 disabled:opacity-50" : "h-10 w-fit rounded-md border border-sky-300 bg-[#f8fbfa] px-4 py-2 text-sm font-semibold text-[#102522] shadow-sm transition hover:bg-sky-100 active:bg-sky-700 active:text-white disabled:cursor-wait disabled:opacity-70"}
          disabled={optimizerStatus === "running"}
          onClick={runOptimizer}
          title="The agent reviews up to three eligible ledgers per batch, processing each ledger independently with its own evidence and protocol checks."
          type="button"
        >
          {optimizerStatus === "running" ? "Running…" : compact ? "Run optimizer" : statusLabel}
        </button>
      </div>

      {optimizerMessage ? (
        <div
          role={optimizerStatus === "error" ? "alert" : "status"}
          className={`mt-4 rounded-lg border p-3 text-sm ${
            optimizerStatus === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-sky-200 bg-sky-50 text-sky-900"
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{optimizerMessage}</span>
            {optimizerStatus === "running" ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-900">
                <span className="size-2 rounded-full bg-sky-500" />
                Thinking...
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {errorMessage ?? "Ledger rows could not be loaded."}
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="mt-5 min-h-0 flex-1 overflow-hidden">
          <TableSkeleton columns={5} rows={4} />
        </div>
      ) : null}

      {status === "live" && rows.length === 0 ? (
        <div className="mt-5 rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] p-4 text-sm text-[#63716f]">
          No ledger rows yet. Add test data to erp_ledger to populate this
          worklist.
        </div>
      ) : null}

      {compact && rows.length > 0 ? (
        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          <table className="scorecard-table">
            <thead><tr><th>Ledger</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="max-w-44 truncate" title={row.description ?? "Untitled entry"}>
                  <a className="hover:text-teal-700 hover:underline" href="/dashboard/ledger-review">{row.description ?? `Ledger #${row.id}`}</a>
                </th>
                <td>{currencyFormatter.format(Number(row.amount ?? 0))}</td>
                <td className="capitalize">{row.status ?? "pending"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {!compact && rows.length > 0 ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#dbe3e1]">
          <div className="hidden shrink-0 grid-cols-[0.7fr_1.3fr_0.9fr_0.8fr_0.8fr] place-items-center bg-[#102522] py-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-white [&>*]:flex [&>*]:h-full [&>*]:w-full [&>*]:items-center [&>*]:justify-center [&>*]:px-4 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-white/15 md:grid">
            <span>ID</span>
            <span>Description</span>
            <span>Department</span>
            <span>Amount</span>
            <span>Status</span>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-[#dbe3e1] overflow-y-auto">
            {rows.map((row) => (
              <LedgerWorklistRow key={row.id} row={row} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Renders one ERP ledger row with status and optimization notes.
function LedgerWorklistRow({ row }: { row: ErpLedgerRow }) {
  const amount = Number(row.amount ?? 0);
  const status = row.status ?? "pending";
  const statusStyle = statusStyles[status] ?? fallbackStatusStyle;

  return (
    <article className="grid gap-3 px-4 py-4 text-center md:grid-cols-[0.7fr_1.3fr_0.9fr_0.8fr_0.8fr] md:place-items-center md:gap-0 md:px-0 md:[&>*]:h-full md:[&>*]:w-full md:[&>*]:content-center md:[&>*]:px-4 md:[&>*:not(:first-child)]:border-l md:[&>*:not(:first-child)]:border-[#e2e8e6]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#74817f] md:hidden">
          ID
        </p>
        <p className="font-mono text-sm text-[#2b3d3a]">#{row.id}</p>
      </div>
      <div>
        <p className="font-medium text-[#102522]">
          {row.description ?? "Untitled ledger entry"}
        </p>
        <p className="mt-1 text-sm text-[#63716f]">
          {row.optimization_notes ?? "No optimization notes recorded."}
        </p>
      </div>
      <p className="text-sm font-medium text-[#2b3d3a]">
        {row.department ?? "Unassigned"}
      </p>
      <p className="text-sm font-semibold text-[#102522]">
        {currencyFormatter.format(amount)}
      </p>
      <div>
        <span
          className={`mx-auto inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusStyle}`}
        >
          {status}
        </span>
      </div>
    </article>
  );
}
