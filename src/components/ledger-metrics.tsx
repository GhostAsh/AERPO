"use client";

import { useMemo } from "react";
import { MetricGridSkeleton } from "@/components/loading-skeletons";
import { useLedgerRows } from "@/lib/ledger/use-ledger-rows";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Computes executive scorecards directly from public.erp_ledger.
export function LedgerMetrics() {
  const { rows, status } = useLedgerRows();

  const metrics = useMemo(() => {
    const totalExposure = rows.reduce(
      (sum, row) => sum + Math.abs(Number(row.amount ?? 0)),
      0,
    );
    const reviewQueue = rows.filter((row) => row.status !== "approved").length;
    const pendingValue = rows
      .filter((row) => row.status !== "approved")
      .reduce((sum, row) => sum + Math.abs(Number(row.amount ?? 0)), 0);
    const approvedValue = rows
      .filter((row) => row.status === "approved")
      .reduce((sum, row) => sum + Math.abs(Number(row.amount ?? 0)), 0);

    return { approvedValue, pendingValue, reviewQueue, totalExposure };
  }, [rows]);

  if (status === "loading") {
    return <MetricGridSkeleton />;
  }

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        detail="From erp_ledger"
        label="Ledger exposure"
        value={currencyFormatter.format(metrics.totalExposure)}
      />
      <MetricCard
        detail="Rows not yet approved"
        label="Review queue"
        value={metrics.reviewQueue.toString()}
      />
      <MetricCard
        detail="Pending and review statuses"
        label="Pending value"
        value={currencyFormatter.format(metrics.pendingValue)}
      />
      <MetricCard
        detail="Cleared by policy checks"
        label="Approved value"
        value={currencyFormatter.format(metrics.approvedValue)}
      />
    </section>
  );
}

// Shows a single executive KPI with its supporting context.
function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-[#63716f]">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-normal text-[#102522]">
        {value}
      </p>
      <p className="mt-2 text-sm text-[#74817f]">{detail}</p>
    </article>
  );
}
