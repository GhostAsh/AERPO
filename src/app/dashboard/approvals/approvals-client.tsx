"use client";

import { useEffect, useMemo, useState } from "react";
import { LedgerDetailModal } from "@/components/ledger-detail-modal";
import { TableSkeleton } from "@/components/loading-skeletons";
import { ColumnFilter, FilterSummary } from "@/components/table-column-filters";
import { matchesColumnFilters, type ColumnFilters, type FilterColumn } from "@/lib/table-filters";
import { ErpLedgerRow } from "@/lib/ledger/use-ledger-rows";

type HumanAction = "approved" | "evidence" | "rejected";

type ApprovalDecision = {
  action: HumanAction;
  completedAt: string | null;
  eventId: number;
  eventStatus: string;
  ledger: ErpLedgerRow | null;
  ledgerId: number;
  note: string;
  recordedAt: string;
};

const actionLabels: Record<HumanAction, string> = {
  approved: "Approved",
  evidence: "Evidence requested",
  rejected: "Rejected",
};

const actionStyles: Record<HumanAction, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  evidence: "border-sky-200 bg-sky-50 text-sky-800",
  rejected: "border-slate-300 bg-slate-100 text-slate-800",
};

const approvalFilterColumns: FilterColumn[] = [
  { key: "ledger", label: "Approval ledger ID" },
  { key: "action", label: "Decision", options: Object.entries(actionLabels).map(([value, label]) => ({ value, label })) },
  { key: "status", label: "Approval status" },
  { key: "amount", label: "Approval amount", type: "number" },
  { key: "recorded", label: "Recorded date", type: "date" },
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
});

export function ApprovalsClient() {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const updateFilter = (key: string, value: string) => setColumnFilters((current) => ({ ...current, [key]: value }));
  const [decisions, setDecisions] = useState<ApprovalDecision[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedDecision, setSelectedDecision] =
    useState<ApprovalDecision | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let isMounted = true;

    async function loadDecisions() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const response = await fetch("/internal-api/ledger-human-actions");
        const result = (await response.json()) as
          | { decisions: ApprovalDecision[] }
          | { error: string };

        if (!response.ok || "error" in result) {
          throw new Error(
            "error" in result
              ? result.error
              : "Approval decisions could not be loaded.",
          );
        }

        if (isMounted) {
          setDecisions(result.decisions);
          setStatus("ready");
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Approval decisions could not be loaded.",
          );
          setStatus("error");
        }
      }
    }

    loadDecisions();

    return () => {
      isMounted = false;
    };
  }, []);

  const metrics = useMemo(() => {
    const awaitingApproval = decisions.filter(
      (decision) => decision.ledger?.status === "review",
    ).length;
    const evidenceRequested = decisions.filter(
      (decision) => decision.action === "evidence",
    ).length;
    const readyToFinalize = decisions.filter(
      (decision) => decision.action === "approved",
    ).length;
    const rejected = decisions.filter(
      (decision) => decision.action === "rejected",
    ).length;

    return { awaitingApproval, evidenceRequested, readyToFinalize, rejected };
  }, [decisions]);

  const totalExposure = useMemo(() => {
    return decisions.reduce(
      (sum, decision) => sum + Math.abs(Number(decision.ledger?.amount ?? 0)),
      0,
    );
  }, [decisions]);

  const filteredDecisions = useMemo(() => decisions.filter((decision) => matchesColumnFilters({
    ledger: `#${decision.ledgerId}`,
    action: decision.action,
    status: decision.ledger?.status ?? decision.eventStatus,
    amount: decision.ledger?.amount,
    recorded: decision.recordedAt,
  }, columnFilters, approvalFilterColumns)), [decisions, columnFilters]);

  return (
    <>
      <section className="grid gap-4 md:grid-cols-4">
        <ApprovalStat label="Awaiting approval" value={metrics.awaitingApproval} />
        <ApprovalStat
          label="Evidence requested"
          value={metrics.evidenceRequested}
        />
        <ApprovalStat label="Ready to finalize" value={metrics.readyToFinalize} />
        <ApprovalStat label="Rejected" value={metrics.rejected} />
      </section>

      <section>
        <div className="min-w-0 rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#102522]">
                Human decisions
              </h2>
              <p className="mt-1 text-sm text-[#63716f]">
                Live protocol outcomes from ledger review actions.
              </p>
            </div>
            <span className="w-fit rounded-full border border-[#dbe3e1] bg-[#f8fbfa] px-3 py-1 text-xs font-semibold text-[#526260]">
              {status === "loading" ? "loading decisions" : `${decisions.length} decisions`}
            </span>
          </div>

          {status === "error" ? (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {errorMessage ?? "Approval decisions could not be loaded."}
            </div>
          ) : null}

          {status === "loading" ? (
            <div className="mt-5">
              <TableSkeleton columns={6} rows={5} />
            </div>
          ) : null}

          {status === "ready" && decisions.length === 0 ? (
            <div className="mt-5 rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] px-4 py-10 text-center text-sm text-[#63716f]">
              No approval decisions are staged yet.
            </div>
          ) : null}

          {status === "ready" && decisions.length > 0 ? (
            <FilterSummary shown={filteredDecisions.length} total={decisions.length} active={Object.values(columnFilters).some(Boolean)} onClear={() => setColumnFilters({})} />
          ) : null}

          {status === "ready" && decisions.length > 0 ? (
            <div className="mt-5 overflow-x-auto rounded-lg border border-[#dbe3e1]">
              <div className="grid min-w-[920px] grid-cols-[12%_30%_15%_13%_18%_12%] place-items-center bg-[#102522] text-center text-xs font-semibold uppercase tracking-[0.14em] text-white [&>*]:flex [&>*]:h-full [&>*]:w-full [&>*]:items-center [&>*]:justify-center [&>*]:px-4 [&>*]:py-3 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-white/15">
                <span>Ledger</span>
                <span>Decision</span>
                <span>Status</span>
                <span>Amount</span>
                <span>Recorded</span>
                <span>Detail</span>
              </div>
              <div role="group" aria-label="Approval column filters" className="grid min-w-[920px] grid-cols-[12%_30%_15%_13%_18%_12%] items-center border-b border-[#dbe3e1] bg-[#f8fbfa] py-2 [&>*]:min-w-0 [&>*]:px-3">
                {approvalFilterColumns.map((column) => <div key={column.key}><ColumnFilter column={column} values={columnFilters} onChange={updateFilter} /></div>)}
                <span aria-hidden="true" />
              </div>
              <div className="divide-y divide-[#dbe3e1]">
                {filteredDecisions.map((decision) => (
                  <ApprovalDecisionRow
                    decision={decision}
                    key={decision.eventId}
                    onOpen={() => setSelectedDecision(decision)}
                  />
                ))}
                {filteredDecisions.length === 0 ? <p className="min-w-[920px] p-8 text-center text-sm text-[#63716f]">No decisions match these filters.</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {selectedDecision?.ledger ? (
        <LedgerDetailModal
          decision={{
            actionLabel: actionLabels[selectedDecision.action],
            note: selectedDecision.note,
          }}
          onClose={() => setSelectedDecision(null)}
          row={selectedDecision.ledger}
          totalExposure={totalExposure}
        />
      ) : null}
    </>
  );
}

function ApprovalDecisionRow({
  decision,
  onOpen,
}: {
  decision: ApprovalDecision;
  onOpen: () => void;
}) {
  const ledger = decision.ledger;

  return (
    <article className="grid min-w-[920px] grid-cols-[12%_30%_15%_13%_18%_12%] place-items-center bg-white text-center text-sm [&>*]:h-full [&>*]:w-full [&>*]:content-center [&>*]:px-4 [&>*]:py-4 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#e2e8e6]">
      <p className="font-mono font-semibold text-[#2b3d3a]">
        #{decision.ledgerId}
      </p>
      <div>
        <div className="mx-auto max-w-[360px]">
          <span
            className={`mx-auto inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${actionStyles[decision.action]}`}
          >
            {actionLabels[decision.action]}
          </span>
          <p className="mt-2 line-clamp-2 text-[#63716f]">{decision.note}</p>
        </div>
      </div>
      <p className="font-semibold capitalize text-[#102522]">
        {ledger?.status ?? decision.eventStatus}
      </p>
      <p className="font-semibold text-[#102522]">
        {currencyFormatter.format(Number(ledger?.amount ?? 0))}
      </p>
      <p className="text-[#63716f]">{dateFormatter.format(new Date(decision.recordedAt))}</p>
      <div>
        <button
          className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ledger}
          onClick={onOpen}
          type="button"
        >
          Detail
        </button>
      </div>
    </article>
  );
}

function ApprovalStat({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-lg border border-[#c8d3d1] bg-white p-5 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#63716f]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-[#102522]">{value}</p>
    </article>
  );
}
