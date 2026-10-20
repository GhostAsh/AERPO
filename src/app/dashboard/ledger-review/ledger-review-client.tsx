"use client";

import { CreateLedgerDialog } from "@/components/create-ledger-dialog";
import { LedgerReviewTable } from "@/components/ledger-review-table";

export function LedgerReviewClient() {
  return (
    <>
      <CreateLedgerDialog />
      <LedgerReviewTable />
    </>
  );
}
