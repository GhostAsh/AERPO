"use client";

import { useMemo, useState } from "react";
import type { ErpLedgerRow } from "@/lib/ledger/use-ledger-rows";

const colors = ["#0f766e", "#10b981", "#0ea5e9", "#d97706", "#526260", "#be123c"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortMoney = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function ScorecardTrend({ rows, loading }: { rows: ErpLedgerRow[]; loading: boolean }) {
  const [months, setMonths] = useState(12);
  const [showTable, setShowTable] = useState(false);
  const chart = useMemo(() => {
    const dated = rows.filter((row) => row.transaction_date && /^\d{4}-\d{2}/.test(row.transaction_date));
    const latest = dated.map((row) => row.transaction_date!.slice(0, 7)).sort().at(-1);
    const end = latest ? new Date(`${latest}-01T12:00:00Z`) : new Date();
    const periods = Array.from({ length: months }, (_, index) => {
      const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1 + index, 1, 12));
      return { key: date.toISOString().slice(0, 7), label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) };
    });
    const totals = new Map<string, number[]>();
    for (const row of dated) {
      const index = periods.findIndex((period) => period.key === row.transaction_date!.slice(0, 7));
      if (index < 0) continue;
      const name = row.department ?? "Unassigned";
      const values = totals.get(name) ?? Array<number>(months).fill(0);
      values[index] += Math.abs(Number(row.amount ?? 0));
      totals.set(name, values);
    }
    const ranked = [...totals].sort((a, b) => b[1].reduce((s, n) => s + n, 0) - a[1].reduce((s, n) => s + n, 0));
    const series = ranked.slice(0, 5).map(([name, values], index) => ({ name, values, color: colors[index] }));
    if (ranked.length > 5) series.push({ name: "Other departments", values: periods.map((_, index) => ranked.slice(5).reduce((sum, [, values]) => sum + values[index], 0)), color: colors[5] });
    return { periods, series, max: Math.max(1, ...series.flatMap((item) => item.values)), hasData: dated.length > 0 };
  }, [rows, months]);
  const x = (index: number) => 64 + index / (months - 1) * 1096;
  const y = (value: number) => 264 - value / chart.max * 220;

  return <section className="scorecard-panel min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold">Ledger value by department</h2><p className="mt-1 text-xs text-[#63716f]">Monthly absolute value by transaction date · last {months} months ending with the latest selected entry</p></div>
      <div className="flex gap-2"><div className="scorecard-segments">{[6, 12, 24].map((count) => <button type="button" key={count} aria-pressed={months === count} onClick={() => setMonths(count)}>{count} mo</button>)}</div><button type="button" className="scorecard-control" aria-expanded={showTable} onClick={() => setShowTable(!showTable)}>{showTable ? "Hide table" : "Show table"}</button></div>
    </div>
    <div className="my-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#63716f]">{chart.series.map((item) => <span className="inline-flex items-center gap-2" key={item.name}><span className="h-0.5 w-3" style={{ background: item.color }} /><strong className="font-medium text-[#2b3d3a]">{item.name}</strong>{money.format(item.values.reduce((sum, value) => sum + value, 0))}</span>)}</div>
    {loading || !chart.hasData ? <div className="flex h-64 items-center justify-center text-sm text-[#74817f]">{loading ? "Loading monthly values…" : "No dated ledger entries in this range."}</div> : <div className="overflow-x-auto">
      <svg className="h-auto min-w-[640px] w-full" viewBox="0 0 1200 310" role="img" aria-label="Monthly ledger value by department. The Show table button provides exact amounts.">
        {[0, 1, 2, 3, 4].map((tick) => <g key={tick}><line x1="64" x2="1160" y1={y(chart.max * tick / 4)} y2={y(chart.max * tick / 4)} stroke="#e2e8e6" strokeDasharray="2 3" /><text x="53" y={y(chart.max * tick / 4) + 4} textAnchor="end" fill="#63716f" fontSize="10">${shortMoney.format(chart.max * tick / 4)}</text></g>)}
        {chart.periods.map((period, index) => <text key={period.key} x={x(index)} y="286" textAnchor="middle" fill="#63716f" fontSize={months === 24 ? 8 : 10}>{period.label}</text>)}
        {chart.series.map((item) => <g key={item.name}><polyline points={item.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" />{item.values.map((value, index) => value > 0 ? <circle key={index} cx={x(index)} cy={y(value)} r="3" fill={item.color}><title>{item.name}, {chart.periods[index].label}: {money.format(value)}</title></circle> : null)}</g>)}
      </svg>
    </div>}
    {showTable ? <div className="mb-4 overflow-auto"><table className="scorecard-table"><caption className="sr-only">Monthly ledger values by department</caption><thead><tr><th>Month</th>{chart.series.map((item) => <th key={item.name}>{item.name}</th>)}</tr></thead><tbody>{chart.periods.map((period, index) => <tr key={period.key}><th scope="row">{period.label}</th>{chart.series.map((item) => <td key={item.name}>{money.format(item.values[index])}</td>)}</tr>)}</tbody></table></div> : null}
    <p className="border-t border-[#e2e8e6] pt-3 text-[10px] leading-4 text-[#74817f]">Uses the selected, loaded ledger entries, not historical approval snapshots. Months without matching entries are shown as zero; entries without a transaction date are excluded.</p>
  </section>;
}
