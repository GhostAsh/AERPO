import { CommandCenterShell } from "@/components/command-center-shell";
import { TelemetryClient } from "@/app/dashboard/telemetry/telemetry-client";

export default function TelemetryPage() {
  return (
    <CommandCenterShell
      activePage="telemetry"
      eyebrow="Agent Behavior Audit"
      title="Telemetry"
    >
      <TelemetryClient />
    </CommandCenterShell>
  );
}
