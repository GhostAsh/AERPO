import { CommandCenterShell } from "@/components/command-center-shell";
import {
  BarsSkeleton,
  TableSkeleton,
} from "@/components/loading-skeletons";

export default function DashboardLoading() {
  return (
    <CommandCenterShell
      activePage="scorecard"
      eyebrow="Loading ERP Optimization"
      title="ERP Analytics"
    >
      <div className="grid gap-4 md:grid-cols-3" aria-label="Loading scorecard">
        {[0, 1, 2].map((index) => <div key={index} className="scorecard-panel flex h-40 animate-pulse flex-col items-center justify-center gap-4"><div className="h-3 w-24 rounded bg-[#e2e8e6]" /><div className="h-8 w-32 rounded bg-[#e2e8e6]" /><div className="h-3 w-28 rounded bg-[#e2e8e6]" /></div>)}
      </div>

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
