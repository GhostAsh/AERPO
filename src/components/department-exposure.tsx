"use client";

import { useMemo } from "react";
import { BarsSkeleton } from "@/components/loading-skeletons";
import { useLedgerRows } from "@/lib/ledger/use-ledger-rows";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const tones = ["bg-teal-500", "bg-emerald-500", "bg-sky-500", "bg-amber-500"];

// Groups ledger value by department for the exposure chart.
export function DepartmentExposure() {
  const { rows, status, errorMessage } = useLedgerRows();

  const exposure = useMemo(() => {
    const totals = new Map<string, number>();

    for (const row of rows) {
      const department = row.department ?? "Unassigned";
      const amount = Math.abs(Number(row.amount ?? 0));
      totals.set(department, (totals.get(department) ?? 0) + amount);
    }

    return Array.from(totals.entries())
      .map(([name, amount], index) => ({
        amount,
        name,
        tone: tones[index % tones.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [rows]);

  const maxAmount = Math.max(...exposure.map((item) => item.amount), 1);

  return (
    <div className="rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-[#102522]">
        Department Exposure
      </h2>
      <p className="mt-1 text-sm text-[#63716f]">
        Current ledger amount grouped by operational owner.
      </p>

      {status === "error" ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {errorMessage ?? "Department exposure could not be loaded."}
        </div>
      ) : null}

      {status === "loading" ? (
        <BarsSkeleton />
      ) : null}

      {status === "live" && exposure.length === 0 ? (
        <div className="mt-5 rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] p-4 text-sm text-[#63716f]">
          No department exposure yet.
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-5">
        {exposure.map((item) => {
          const width = `${Math.max(4, Math.round((item.amount / maxAmount) * 100))}%`;

          return (
            <div key={item.name}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[#2b3d3a]">{item.name}</span>
                <span className="font-semibold text-[#102522]">
                  {currencyFormatter.format(item.amount)}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-[#edf2f1]">
                <div
                  className={`h-full rounded-full ${item.tone}`}
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
