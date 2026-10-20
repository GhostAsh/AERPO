import { CommandCenterShell } from "@/components/command-center-shell";
import { CorrectionsClient } from "@/app/dashboard/corrections/corrections-client";

export default function CorrectionsPage() {
  return (
    <CommandCenterShell
      activePage="corrections"
      eyebrow="Protocol-Bound Remediation"
      title="Corrections"
    >
      <CorrectionsClient />
    </CommandCenterShell>
  );
}
