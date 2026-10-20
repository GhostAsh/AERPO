import { CommandCenterShell } from "@/components/command-center-shell";
import { ApprovalsClient } from "@/app/dashboard/approvals/approvals-client";

export default function ApprovalsPage() {
  return (
    <CommandCenterShell
      activePage="approvals"
      eyebrow="Human Decision Control"
      title="Approvals"
    >
      <ApprovalsClient />
    </CommandCenterShell>
  );
}
