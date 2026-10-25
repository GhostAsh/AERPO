import { CommandCenterShell } from "@/components/command-center-shell";
import { DashboardClient } from "@/app/dashboard/dashboard-client";

// Renders the full command-center shell and current ERP scorecard surface.
export default function DashboardPage() {
  return (
    <CommandCenterShell
      activePage="scorecard"
      eyebrow="Executive ERP Optimization"
      title="ERP Analytics"
    >
      <DashboardClient />
    </CommandCenterShell>
  );
}
