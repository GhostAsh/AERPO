"use client";

import { DepartmentExposure } from "@/components/department-exposure";
import { CreateLedgerDialog } from "@/components/create-ledger-dialog";
import { LedgerMetrics } from "@/components/ledger-metrics";
import { LedgerWorklist } from "@/components/ledger-worklist";
import { TelemetryFeed } from "@/components/telemetry-feed";

export function DashboardClient() {
  return (
    <>
      <CreateLedgerDialog />

      <LedgerMetrics />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <LedgerWorklist />

        <DepartmentExposure />
      </section>

      <TelemetryFeed />
    </>
  );
}
