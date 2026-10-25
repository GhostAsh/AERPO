"use client";

import { useEffect, useMemo, useState } from "react";
import { CreateLedgerDialog } from "@/components/create-ledger-dialog";
import { LedgerWorklistPanel } from "@/components/ledger-worklist";
import { ScorecardTrend } from "@/components/scorecard-trend";
import { TelemetryFeed } from "@/components/telemetry-feed";
import { useLedgerRows } from "@/lib/ledger/use-ledger-rows";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const chicagoDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
function todayValue() {
  const parts = chicagoDate.formatToParts(new Date());
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

export function DashboardClient() {
  const { rows, status, errorMessage } = useLedgerRows();
  const [range, setRange] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    if (status === "live") setUpdated(new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago" }));
  }, [rows, status]);

  function selectRange(next: string) {
    setRange(next);
    if (next === "All") { setFrom(""); setTo(""); return; }
    const today = todayValue();
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (next === "Week" ? 6 : next === "Month" ? 29 : 0));
    setFrom(start.toISOString().slice(0, 10));
    setTo(today);
  }
  const invalidRange = Boolean(from && to && from > to);
  const selected = useMemo(() => rows.filter((row) => {
    if (invalidRange) return false;
    if (!from && !to) return true;
    const date = row.transaction_date?.slice(0, 10);
    return Boolean(date && (!from || date >= from) && (!to || date <= to));
  }), [rows, from, to, invalidRange]);
  const total = selected.reduce((sum, row) => sum + Math.abs(Number(row.amount ?? 0)), 0);
  const approved = selected.filter((row) => row.status === "approved").reduce((sum, row) => sum + Math.abs(Number(row.amount ?? 0)), 0);
  const queue = selected.filter((row) => row.status !== "approved").length;
  const departments = useMemo(() => groupRows(selected, "department"), [selected]);
  const statuses = useMemo(() => groupRows(selected, "status"), [selected]);

  function exportCsv() {
    const escape = (value: unknown) => {
      let text = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [
      ["Ledger ID", "Date", "Description", "Department", "Amount", "Status"],
      ...selected.map((row) => [row.id, row.transaction_date, row.description, row.department, row.amount, row.status]),
    ].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "erp-scorecard.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const metrics = [
    ["Ledger exposure", money.format(total), "total absolute ledger value", `${selected.length} entries in range`],
    ["Approved value", money.format(approved), "value cleared for approval", total ? `${Math.round(approved / total * 100)}% of ledger exposure` : "No ledger value in range"],
    ["Review queue", queue.toLocaleString(), "entries not yet approved", `${money.format(total - approved)} awaiting resolution`],
  ];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[#63716f]" aria-live="polite">{status === "loading" ? "Loading scorecard…" : updated ? `Last refreshed ${updated} CT · updates automatically` : "Waiting for ledger data"}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="scorecard-segments" aria-label="Date range">{["All", "Today", "Week", "Month"].map((item) => <button key={item} type="button" aria-pressed={range === item} onClick={() => selectRange(item)}>{item}</button>)}</div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#c8d3d1] bg-white px-2 py-1 text-[11px] text-[#63716f]">
            <label className="flex items-center gap-2">From <input className="min-w-0 rounded border border-[#c8d3d1] px-1 py-1 text-[#2b3d3a]" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setRange("Custom"); }} /></label>
            <label className="flex items-center gap-2">To <input className="min-w-0 rounded border border-[#c8d3d1] px-1 py-1 text-[#2b3d3a]" type="date" value={to} onChange={(event) => { setTo(event.target.value); setRange("Custom"); }} /></label>
          </div>
          <button className="scorecard-control disabled:opacity-40" type="button" onClick={exportCsv} disabled={status !== "live" || selected.length === 0}>Export CSV ↗</button>
          <CreateLedgerDialog compact />
        </div>
      </div>
      {invalidRange ? <p role="alert" className="text-sm text-rose-700">Choose an end date on or after the start date.</p> : null}
      {errorMessage ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Ledger data could not refresh: {errorMessage}. Displayed values may be out of date.</p> : null}
      <section aria-label="Key metrics" className="grid gap-4 md:grid-cols-3">
        {metrics.map(([label, value, detail, note]) => <article className="scorecard-panel flex min-h-40 flex-col items-center justify-center text-center" key={label}>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#63716f]">{label}</h2>
          <p className="mt-6 text-3xl font-bold tracking-tight tabular-nums">{status === "loading" || (status === "error" && !rows.length) ? "—" : value}</p>
          <p className="mt-1 text-xs text-[#63716f]">{detail}</p>
          <p className="mt-2 text-[10px] uppercase tracking-wide text-[#74817f]">{note}</p>
        </article>)}
      </section>
      <section aria-label="Ledger breakdowns" className="grid gap-4 xl:grid-cols-3">
        <LedgerWorklistPanel rows={selected} status={status} errorMessage={errorMessage} compact />
        <Breakdown title="Exposure by department" subtitle="Absolute ledger value, largest first" groups={departments} total={total} loading={status === "loading"} firstColumn="Department" />
        <Breakdown title="Value by approval status" subtitle="Current status of entries in the selected range" groups={statuses} total={total} loading={status === "loading"} firstColumn="Status" />
      </section>
      <p className="text-[11px] leading-5 text-[#63716f]"><strong>Where these numbers come from.</strong> The latest 100 ledger entries, filtered by transaction date. Exposure uses absolute amounts; the review queue includes all entries not marked approved. The optimizer reviews up to three eligible ledgers across the full ledger, independently of these date filters.</p>
      <ScorecardTrend rows={selected} loading={status === "loading"} />
      <TelemetryFeed light />
    </>
  );
}

type Group = [string, { count: number; amount: number }];
function groupRows(rows: ReturnType<typeof useLedgerRows>["rows"], field: "department" | "status"): Group[] {
  const groups = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    const name = row[field] ?? (field === "status" ? "pending" : "Unassigned");
    const group = groups.get(name) ?? { count: 0, amount: 0 };
    group.count++;
    group.amount += Math.abs(Number(row.amount ?? 0));
    groups.set(name, group);
  }
  return [...groups].sort((a, b) => b[1].amount - a[1].amount);
}
function Breakdown({ title, subtitle, groups, total, loading, firstColumn }: {
  title: string; subtitle: string; groups: Group[]; total: number; loading: boolean; firstColumn: string;
}) {
  return <section className="scorecard-panel flex h-[340px] min-w-0 flex-col">
    <h2 className="text-sm font-semibold">{title}</h2>
    <p className="mt-1 text-xs text-[#63716f]">{subtitle}</p>
    <div className="mt-4 min-h-0 flex-1 overflow-auto">
      <table className="scorecard-table">
        <thead><tr><th>{firstColumn}</th><th>Value</th><th>Share</th><th>Entries</th></tr></thead>
        <tbody>{groups.map(([name, group]) => <tr key={name}><th scope="row" className="capitalize">{name}</th><td>{money.format(group.amount)}</td><td>{total ? (group.amount / total * 100).toFixed(1) : "0.0"}%</td><td>{group.count}</td></tr>)}</tbody>
        {groups.length ? <tfoot><tr><th scope="row">Range total</th><td>{money.format(total)}</td><td>{total ? "100%" : "0%"}</td><td>{groups.reduce((sum, [, group]) => sum + group.count, 0)}</td></tr></tfoot> : null}
      </table>
      {!groups.length ? <p className="py-10 text-center text-xs text-[#74817f]">{loading ? "Loading breakdown…" : "No entries in this range."}</p> : null}
    </div>
    <p className="mt-3 border-t border-[#e2e8e6] pt-3 text-[10px] leading-4 text-[#74817f]">Based on the current values of the loaded ledger entries.</p>
  </section>;
}
