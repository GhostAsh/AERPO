"use client";

import type { ColumnFilters, FilterColumn } from "@/lib/table-filters";

const controlClass = "h-9 w-full min-w-0 rounded-md border border-[#c8d3d1] bg-white px-2 text-xs font-normal normal-case tracking-normal text-[#2b3d3a] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100";

export function ColumnFilter({ column, values, onChange }: {
  column: FilterColumn;
  values: ColumnFilters;
  onChange: (key: string, value: string) => void;
}) {
  if (column.type) {
    return <div className="flex min-w-0 flex-col gap-1">
      {(["Min", "Max"] as const).map((bound) => <input
        key={bound}
        aria-label={`${column.label} ${column.type === "date" ? (bound === "Min" ? "from" : "to") : bound.toLowerCase()}`}
        className={controlClass}
        type={column.type === "date" ? "date" : "number"}
        step={column.type === "number" ? "any" : undefined}
        placeholder={bound}
        value={values[`${column.key}${bound}`] ?? ""}
        onChange={(event) => onChange(`${column.key}${bound}`, event.target.value)}
      />)}
    </div>;
  }
  if (column.options) {
    return <select aria-label={`Filter ${column.label}`} className={controlClass} value={values[column.key] ?? ""} onChange={(event) => onChange(column.key, event.target.value)}>
      <option value="">All</option>
      {column.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  }
  return <input aria-label={`Filter ${column.label}`} className={controlClass} type="search" placeholder="Filter…" value={values[column.key] ?? ""} onChange={(event) => onChange(column.key, event.target.value)} />;
}

export function FilterSummary({ shown, total, onClear, active }: {
  shown: number; total: number; onClear: () => void; active: boolean;
}) {
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#63716f]">
    <p role="status">Showing {shown} of {total} loaded rows</p>
    <button type="button" onClick={onClear} disabled={!active} className="rounded border border-[#c8d3d1] bg-[#f8fbfa] px-3 py-1.5 font-semibold text-teal-800 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-600 disabled:cursor-default disabled:opacity-40">Clear filters</button>
  </div>;
}
