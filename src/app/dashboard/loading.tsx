import { CommandCenterShell } from "@/components/command-center-shell";
import {
  BarsSkeleton,
  MetricGridSkeleton,
  TableSkeleton,
} from "@/components/loading-skeletons";

export default function DashboardLoading() {
  return (
    <CommandCenterShell
      activePage="scorecard"
      eyebrow="Loading ERP Optimization"
      title="Preparing dashboard"
    >
      <MetricGridSkeleton />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
          <div className="mb-5 space-y-2">
            <div className="h-5 w-40 animate-pulse rounded-md bg-[#dbe3e1]" />
            <div className="h-4 w-64 animate-pulse rounded-md bg-[#dbe3e1]" />
          </div>
          <TableSkeleton columns={5} rows={4} />
        </div>

        <div className="rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
          <div className="mb-5 space-y-2">
            <div className="h-5 w-48 animate-pulse rounded-md bg-[#dbe3e1]" />
            <div className="h-4 w-72 animate-pulse rounded-md bg-[#dbe3e1]" />
          </div>
          <BarsSkeleton />
        </div>
      </section>
    </CommandCenterShell>
  );
}
