"use client";

import { useEffect, useMemo, useState } from "react";
import { LedgerDetailModal } from "@/components/ledger-detail-modal";
import { TableSkeleton } from "@/components/loading-skeletons";
import { ErpLedgerRow, useLedgerRows } from "@/lib/ledger/use-ledger-rows";

type HumanAction = "approved" | "rejected" | "evidence";

type ReviewDecision = {
  action: HumanAction;
  ledgerId: number;
  note: string;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const fallbackStatusStyle = "border-slate-200 bg-slate-50 text-slate-700";

const statusStyles: Record<string, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  duplicate: "border-slate-300 bg-slate-100 text-slate-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  review: "border-rose-200 bg-rose-50 text-rose-800",
};

const actionLabels: Record<HumanAction, string> = {
  approved: "Approve",
  evidence: "Request evidence",
  rejected: "Reject",
};

export function LedgerReviewTable() {
  const { rows, status, errorMessage } = useLedgerRows(250);
  const [selectedLedgerId, setSelectedLedgerId] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<ReviewDecision[]>([]);
  const [correctionLockedLedgerIds, setCorrectionLockedLedgerIds] = useState<
    number[]
  >([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [agentReviewMessage, setAgentReviewMessage] = useState<string | null>(
    null,
  );
  const [agentReviewStatus, setAgentReviewStatus] = useState<
    "idle" | "running" | "complete" | "error"
  >("idle");
  const [reviewingLedgerId, setReviewingLedgerId] = useState<number | null>(
    null,
  );
  const [savingAction, setSavingAction] = useState<HumanAction | null>(null);
  const [savingLedgerId, setSavingLedgerId] = useState<number | null>(null);

  const selectedRow = useMemo(() => {
    if (selectedLedgerId === null) {
      return null;
    }

    return rows.find((row) => row.id === selectedLedgerId) ?? null;
  }, [rows, selectedLedgerId]);

  const reviewStats = useMemo(() => {
    const totalValue = rows.reduce(
      (sum, row) => sum + Math.abs(Number(row.amount ?? 0)),
      0,
    );
    const needsReview = rows.filter((row) => row.status !== "approved").length;
    const stagedResponses = decisions.length;

    return { needsReview, stagedResponses, totalValue };
  }, [decisions, rows]);

  useEffect(() => {
    let isMounted = true;

    async function loadHumanActions() {
      try {
        const response = await fetch("/internal-api/ledger-human-actions");
        const result = (await response.json()) as
          | {
              correctionLockedLedgerIds: number[];
              decisions: ReviewDecision[];
            }
          | { error: string };

        if (!isMounted) {
          return;
        }

        if (!response.ok || "error" in result) {
          throw new Error(
            "error" in result ? result.error : "Human actions could not load.",
          );
        }

        setDecisions(result.decisions);
        setCorrectionLockedLedgerIds(result.correctionLockedLedgerIds);
      } catch (error) {
        if (isMounted) {
          setDecisionError(
            error instanceof Error
              ? error.message
              : "Human actions could not load.",
          );
        }
      }
    }

    loadHumanActions();

    return () => {
      isMounted = false;
    };
  }, []);

  async function stageDecision(row: ErpLedgerRow, action: HumanAction) {
    if (
      (row.status !== "pending" && row.status !== "review") ||
      correctionLockedLedgerIds.includes(row.id)
    ) {
      setDecisionError(
        "This ledger already has a final or correction-controlled decision.",
      );
      return;
    }

    setDecisionError(null);
    setSavingAction(action);
    setSavingLedgerId(row.id);

    try {
      const response = await fetch("/internal-api/ledger-human-actions", {
        body: JSON.stringify({ action, ledgerId: row.id }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json()) as
        | { decision: ReviewDecision }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result ? result.error : "Human action could not be saved.",
        );
      }

      setDecisions((currentDecisions) => [
        result.decision,
        ...currentDecisions.filter((decision) => decision.ledgerId !== row.id),
      ]);
    } catch (error) {
      setDecisionError(
        error instanceof Error ? error.message : "Human action could not be saved.",
      );
    } finally {
      setSavingLedgerId((currentLedgerId) =>
        currentLedgerId === row.id ? null : currentLedgerId,
      );
      setSavingAction(null);
    }
  }

  async function runAgentReview(row: ErpLedgerRow) {
    setAgentReviewMessage(`Agent is reviewing ledger #${row.id}...`);
    setAgentReviewStatus("running");
    setReviewingLedgerId(row.id);

    try {
      const response = await fetch("/api/optimizer/run", {
        body: JSON.stringify({ ledgerId: row.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as
        | {
            correction_ids?: number[];
            existing_correction_ids?: number[];
            inspected: number;
            status_update_skipped?: number;
            status_updates?: { ledger_id: number; status: string }[];
            telemetry_ids: number[];
          }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result ? result.error : "Agent review failed.",
        );
      }

      if (result.inspected !== 1) {
        throw new Error("This ledger is not eligible for agent review.");
      }

      const nextStatus = result.status_updates?.[0]?.status;
      const correctionQueued = (result.correction_ids?.length ?? 0) > 0;
      const correctionAlreadyPending =
        (result.existing_correction_ids?.length ?? 0) > 0;
      setAgentReviewStatus("complete");
      setAgentReviewMessage(
        correctionQueued
          ? `Ledger #${row.id} reviewed. A correction was queued for human approval.`
          : correctionAlreadyPending
          ? `Ledger #${row.id} reviewed. Its existing correction is still awaiting human approval.`
          : nextStatus
          ? `Ledger #${row.id} reviewed. Status updated to ${nextStatus}.`
          : `Ledger #${row.id} reviewed. The protocol did not authorize a status change.`,
      );
    } catch (error) {
      setAgentReviewStatus("error");
      setAgentReviewMessage(
        error instanceof Error ? error.message : "Agent review failed.",
      );
    } finally {
      setReviewingLedgerId(null);
    }
  }

  return (
    <section>
      <div className="min-w-0 rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#102522]">
              Ledger Review Queue
            </h2>
            <p className="mt-1 text-sm text-[#63716f]">
              Live erp_ledger rows with human response controls.
            </p>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <ReviewStat
              label="Rows"
              value={status === "loading" ? "..." : rows.length.toString()}
            />
            <ReviewStat
              label="Needs review"
              value={reviewStats.needsReview.toString()}
            />
            <ReviewStat
              label="Staged"
              value={reviewStats.stagedResponses.toString()}
            />
          </div>
        </div>

        {status === "error" ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {errorMessage ?? "Ledger review rows could not be loaded."}
          </div>
        ) : null}

        {decisionError ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {decisionError}
          </div>
        ) : null}

        {agentReviewMessage ? (
          <div
            className={`mt-5 flex flex-col gap-2 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${
              agentReviewStatus === "error"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}
            role="status"
          >
            <span>{agentReviewMessage}</span>
            {agentReviewStatus === "running" ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold">
                <span className="size-2 rounded-full bg-sky-500" />
                Thinking...
              </span>
            ) : null}
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="mt-5">
            <TableSkeleton columns={9} rows={6} />
          </div>
        ) : null}

        {status === "live" && rows.length === 0 ? (
          <div className="mt-5 rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] p-4 text-sm text-[#63716f]">
            No ledger rows are available yet.
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="mt-5 rounded-lg border border-[#dbe3e1]">
            <div className="hidden min-w-[1410px] grid-cols-[72px_116px_minmax(320px,1fr)_132px_118px_110px_170px_142px_104px] place-items-center gap-4 bg-[#f4f7f6] px-5 py-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-[#63716f] xl:grid">
              <span className="self-center">ID</span>
              <span className="self-center">Date</span>
              <span className="self-center">Description</span>
              <span className="self-center">Dept.</span>
              <span className="self-center">Amount</span>
              <span className="self-center">Status</span>
              <span className="self-center">Human action</span>
              <span className="self-center">Agent review</span>
              <span className="self-center">Detail</span>
            </div>
            <div className="divide-y divide-[#dbe3e1]">
              {rows.map((row) => (
                <LedgerReviewRow
                  correctionLocked={correctionLockedLedgerIds.includes(row.id)}
                  decision={decisions.find(
                    (decision) => decision.ledgerId === row.id,
                  )}
                  key={row.id}
                  onAgentReview={runAgentReview}
                  onSelect={() => setSelectedLedgerId(row.id)}
                  onStageDecision={stageDecision}
                  row={row}
                  savingAction={savingLedgerId === row.id ? savingAction : null}
                  saving={savingLedgerId === row.id}
                  reviewing={reviewingLedgerId === row.id}
                  selected={selectedRow?.id === row.id}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {selectedRow ? (
        <LedgerDetailModal
          decision={toLedgerDetailDecision(
            decisions.find((decision) => decision.ledgerId === selectedRow.id),
          )}
          onClose={() => setSelectedLedgerId(null)}
          row={selectedRow}
          totalExposure={reviewStats.totalValue}
        />
      ) : null}
    </section>
  );
}

function LedgerReviewRow({
  correctionLocked,
  decision,
  onAgentReview,
  onSelect,
  onStageDecision,
  row,
  savingAction,
  saving,
  reviewing,
  selected,
}: {
  correctionLocked: boolean;
  decision?: ReviewDecision;
  onAgentReview: (row: ErpLedgerRow) => Promise<void>;
  onSelect: () => void;
  onStageDecision: (row: ErpLedgerRow, action: HumanAction) => Promise<void>;
  row: ErpLedgerRow;
  savingAction: HumanAction | null;
  saving: boolean;
  reviewing: boolean;
  selected: boolean;
}) {
  const amount = Number(row.amount ?? 0);
  const status = row.status ?? "pending";
  const statusStyle = statusStyles[status] ?? fallbackStatusStyle;
  const date = row.transaction_date ? new Date(row.transaction_date) : null;
  const dateLabel = date ? dateFormatter.format(date) : "Pending";
  const canReview = status === "pending" || status === "review";
  const actionLocked = !canReview || correctionLocked || decision !== undefined;
  const actionPlaceholder = correctionLocked
    ? "Correction decided"
    : !canReview
      ? "Finalized"
      : "Select action";

  return (
    <article
      className={`grid min-w-[1410px] gap-4 px-5 py-5 text-center transition xl:grid-cols-[72px_116px_minmax(320px,1fr)_132px_118px_110px_170px_142px_104px] xl:place-items-center ${
        selected ? "bg-teal-50/70" : "bg-white"
      }`}
    >
      <p className="font-mono text-sm font-semibold text-[#2b3d3a]">#{row.id}</p>
      <p className="text-sm text-[#2b3d3a]">{dateLabel}</p>
      <div className="mx-auto min-w-0 max-w-[420px]">
        <p className="text-sm font-semibold leading-6 text-[#102522]">
          {row.description ?? "Untitled ledger entry"}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#63716f]">
          {row.optimization_notes ?? "No optimization notes recorded."}
        </p>
      </div>
      <p className="text-sm font-medium leading-6 text-[#2b3d3a]">
        {row.department ?? "Unassigned"}
      </p>
      <p className="text-sm font-semibold text-[#102522]">
        {currencyFormatter.format(amount)}
      </p>
      <span
        className={`mx-auto w-fit rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusStyle}`}
      >
        {status}
      </span>
      <div className="relative w-full max-w-[170px]">
        <select
          aria-label={`Human action for ledger ${row.id}`}
          className="h-10 w-full appearance-none rounded-md border border-[#c8d3d1] bg-white px-3 pr-9 text-sm font-semibold text-[#102522] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-[#f4f7f6] disabled:text-[#63716f] disabled:opacity-70"
          disabled={actionLocked || saving}
          onChange={(event) => {
            const action = event.target.value as HumanAction | "";

            if (action) {
              onStageDecision(row, action);
            }
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          title={
            correctionLocked
              ? "The correction workflow already recorded a decision"
              : !canReview
                ? "Finalized ledgers cannot receive another human decision"
                : decision
                  ? "A human action is already recorded"
                  : `Select a human action for ledger #${row.id}`
          }
          value={decision?.action ?? ""}
        >
          <option value="">{actionPlaceholder}</option>
          <option value="approved">Approve</option>
          <option value="evidence">Request evidence</option>
          <option value="rejected">Reject</option>
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#63716f]">
          {saving ? "..." : "v"}
        </span>
        {saving ? (
          <p className="mt-2 text-xs font-semibold text-teal-800">
            {savingAction === "evidence" ? "Gathering evidence..." : "Saving..."}
          </p>
        ) : null}
      </div>
      <button
        className="h-10 w-full max-w-[142px] rounded-md border border-sky-300 bg-sky-50 px-3 text-sm font-semibold text-sky-900 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canReview || reviewing || saving}
        onClick={() => onAgentReview(row)}
        title={
          canReview
            ? `Run agent review for ledger #${row.id}`
            : "Finalized ledgers cannot be reviewed again"
        }
        type="button"
      >
        {reviewing ? "Thinking..." : "Review"}
      </button>
      <button
        className="mx-auto h-10 w-fit rounded-md border border-teal-300 bg-teal-50 px-3 text-sm font-semibold text-teal-900 transition hover:bg-teal-100"
        onClick={onSelect}
        type="button"
      >
        Detail
      </button>
    </article>
  );
}

function ReviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#dbe3e1] bg-[#f8fbfa] px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#63716f]">
        {label}
      </p>
      <p className="mt-1 font-semibold text-[#102522]">{value}</p>
    </div>
  );
}

function toLedgerDetailDecision(decision?: ReviewDecision) {
  if (!decision) {
    return undefined;
  }

  return {
    actionLabel: actionLabels[decision.action],
    note: decision.note,
  };
}
