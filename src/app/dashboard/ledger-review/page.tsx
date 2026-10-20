import { CommandCenterShell } from "@/components/command-center-shell";
import { LedgerReviewClient } from "@/app/dashboard/ledger-review/ledger-review-client";

export default function LedgerReviewPage() {
  return (
    <CommandCenterShell
      activePage="ledger-review"
      eyebrow="Human-in-the-loop ERP Optimization"
      title="Ledger review"
    >
      <LedgerReviewClient />
    </CommandCenterShell>
  );
}
