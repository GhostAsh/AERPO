"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DropdownIndicator } from "@/components/dropdown-indicator";
import { LedgerDetailModal } from "@/components/ledger-detail-modal";
import { TableSkeleton } from "@/components/loading-skeletons";
import { ErpLedgerRow } from "@/lib/ledger/use-ledger-rows";
import { supabase } from "@/lib/supabase/browser";

type CorrectionCandidate = {
  beforeValue: unknown;
  confidenceScore: number;
  correctionAppliedAt: string | null;
  correctionCreatedAt: string | null;
  correctionEdits: CorrectionEdit[];
  correctionEvidence: unknown;
  correctionId: number | null;
  correctionRationale: string | null;
  correctionUpdatedAt: string | null;
  decision: CorrectionDecision | null;
  decisionEventId: number | null;
  decisionRecordedAt: string | null;
  eventId: number;
  evidence: string;
  executionError: string | null;
  executionStatus: CorrectionExecutionStatus | null;
  hypothesis: string;
  ledger: ErpLedgerRow | null;
  ledgerId: number | null;
  proposedValue: unknown;
  reviewNote: string | null;
  stepExecuted: string;
  targetColumn: string | null;
  timestamp: string | null;
};

type CorrectionEdit = {
  afterValue: unknown;
  beforeValue: unknown;
  createdAt: string;
  editNote: string | null;
  id: number;
};

type CorrectionDecision = "approved" | "rejected";

type CorrectionExecutionStatus =
  | "not_ready"
  | "ready"
  | "applying"
  | "applied"
  | "failed"
  | "cancelled";

type FilterValue = "all" | "create_correction_candidate" | "gather_evidence" | "mark_duplicate";

type WorkflowFilterValue =
  | "all"
  | "awaiting_review"
  | "ready_to_apply"
  | "applied"
  | "rejected"
  | "failed"
  | "telemetry_only";

type AgentTelemetryRealtimeRow = {
  step_executed?: string | null;
};

type PromptEventRealtimeRow = {
  event_type?: string | null;
  telemetry_id?: number | null;
};

const filters: { label: string; value: FilterValue }[] = [
  { label: "All", value: "all" },
  { label: "Corrections", value: "create_correction_candidate" },
  { label: "Evidence", value: "gather_evidence" },
  { label: "Duplicates", value: "mark_duplicate" },
];

const workflowFilters: { label: string; value: WorkflowFilterValue }[] = [
  { label: "All states", value: "all" },
  { label: "Awaiting review", value: "awaiting_review" },
  { label: "Ready to apply", value: "ready_to_apply" },
  { label: "Applied", value: "applied" },
  { label: "Rejected", value: "rejected" },
  { label: "Failed", value: "failed" },
  { label: "Telemetry only", value: "telemetry_only" },
];

const correctionStepValues = new Set([
  "create_correction_candidate",
  "gather_evidence",
  "mark_duplicate",
]);

const stepLabels: Record<string, string> = {
  create_correction_candidate: "Correction",
  gather_evidence: "Evidence",
  mark_duplicate: "Duplicate",
};

const stepStyles: Record<string, string> = {
  create_correction_candidate: "border-teal-200 bg-teal-50 text-teal-800",
  gather_evidence: "border-sky-200 bg-sky-50 text-sky-800",
  mark_duplicate: "border-slate-300 bg-slate-100 text-slate-800",
};

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

export function CorrectionsClient() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");
  const [workflowFilter, setWorkflowFilter] =
    useState<WorkflowFilterValue>("all");
  const [candidates, setCandidates] = useState<CorrectionCandidate[]>([]);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingCorrectionId, setEditingCorrectionId] = useState<number | null>(
    null,
  );
  const [executingCorrectionId, setExecutingCorrectionId] = useState<
    number | null
  >(null);
  const [savingEventId, setSavingEventId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let isMounted = true;

    async function loadCorrections({ showLoading = false } = {}) {
      if (showLoading) {
        setStatus("loading");
      }
      setErrorMessage(null);

      try {
        const response = await fetch("/internal-api/corrections");
        const result = (await response.json()) as
          | { corrections: CorrectionCandidate[] }
          | { error: string };

        if (!response.ok || "error" in result) {
          throw new Error(
            "error" in result ? result.error : "Corrections could not be loaded.",
          );
        }

        if (isMounted) {
          setCandidates(result.corrections);
          setStatus("ready");
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Corrections could not be loaded.",
          );
          setStatus("error");
        }
      }
    }

    loadCorrections({ showLoading: true });

    const channel = supabase
      .channel("corrections-worklist")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_telemetry",
        },
        (payload) => {
          const nextRow = payload.new as AgentTelemetryRealtimeRow;

          if (
            typeof nextRow.step_executed === "string" &&
            correctionStepValues.has(nextRow.step_executed)
          ) {
            loadCorrections();
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ledger_correction_proposals",
        },
        () => loadCorrections(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "erp_ledger",
        },
        () => loadCorrections(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ledger_agent_prompt_events",
        },
        (payload) => {
          const nextRow = payload.new as PromptEventRealtimeRow;

          if (
            typeof nextRow.telemetry_id === "number" &&
            (nextRow.event_type === "human_approval" ||
              nextRow.event_type === "human_rejection")
          ) {
            loadCorrections();
          }
        },
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "CHANNEL_ERROR") {
          setStatus("error");
          setErrorMessage("Realtime channel could not connect.");
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  async function saveDecision(
    candidate: CorrectionCandidate,
    decision: CorrectionDecision,
    reviewNote = "",
  ) {
    setDecisionError(null);
    setSavingEventId(candidate.eventId);

    try {
      const response = await fetch("/internal-api/corrections", {
        body: JSON.stringify({
          correctionEventId: candidate.eventId,
          decision,
          reviewNote,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as
        | {
            decision: {
              decision: CorrectionDecision;
              decisionEventId: number;
              decisionRecordedAt: string;
              eventId: number;
              correctionId?: number | null;
              executionStatus?: CorrectionExecutionStatus | null;
              reviewNote?: string | null;
            };
          }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result
            ? result.error
            : "The correction decision could not be saved.",
        );
      }

      setCandidates((current) =>
        current.map((item) =>
          item.eventId === result.decision.eventId
            ? {
                ...item,
                decision: result.decision.decision,
                decisionEventId: result.decision.decisionEventId,
                decisionRecordedAt: result.decision.decisionRecordedAt,
                correctionId:
                  result.decision.correctionId ?? item.correctionId,
                executionStatus:
                  result.decision.executionStatus ?? item.executionStatus,
                reviewNote:
                  (result.decision.reviewNote ?? reviewNote) || null,
              }
            : item,
        ),
      );
    } catch (error) {
      setDecisionError(
        error instanceof Error
          ? error.message
          : "The correction decision could not be saved.",
      );
    } finally {
      setSavingEventId(null);
    }
  }

  async function executeCorrection(candidate: CorrectionCandidate) {
    if (!candidate.correctionId) {
      return;
    }

    setDecisionError(null);
    setExecutingCorrectionId(candidate.correctionId);

    try {
      const response = await fetch("/internal-api/corrections", {
        body: JSON.stringify({
          correctionId: candidate.correctionId,
          operation: "execute",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as
        | {
            execution: {
              appliedAt?: string;
              correctionId: number;
              executionStatus: CorrectionExecutionStatus;
            };
          }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result
            ? result.error
            : "The correction could not be applied.",
        );
      }

      setCandidates((current) =>
        current.map((item) =>
          item.correctionId === result.execution.correctionId
            ? {
                ...item,
                correctionAppliedAt:
                  result.execution.appliedAt ?? new Date().toISOString(),
                correctionUpdatedAt:
                  result.execution.appliedAt ?? new Date().toISOString(),
                executionError: null,
                executionStatus: result.execution.executionStatus,
              }
            : item,
        ),
      );
    } catch (error) {
      setDecisionError(
        error instanceof Error
          ? error.message
          : "The correction could not be applied.",
      );
    } finally {
      setExecutingCorrectionId(null);
    }
  }

  async function saveCorrectionEdit(
    candidate: CorrectionCandidate,
    proposedStatus: string,
    reviewNote: string,
  ) {
    if (!candidate.correctionId) {
      return;
    }

    setDecisionError(null);
    setEditingCorrectionId(candidate.correctionId);

    try {
      const response = await fetch("/internal-api/corrections", {
        body: JSON.stringify({
          correctionId: candidate.correctionId,
          operation: "edit",
          proposedStatus,
          reviewNote,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as
        | {
            correction: {
              correctionId: number;
              editId: number | null;
              proposedValue: unknown;
              reviewNote: string | null;
              updatedAt: string;
            };
          }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result
            ? result.error
            : "The correction edit could not be saved.",
        );
      }

      setCandidates((current) =>
        current.map((item) =>
          item.correctionId === result.correction.correctionId
            ? {
                ...item,
                correctionEdits:
                  result.correction.editId === null
                    ? item.correctionEdits
                    : [
                        ...item.correctionEdits,
                        {
                          afterValue: result.correction.proposedValue,
                          beforeValue: item.proposedValue,
                          createdAt: result.correction.updatedAt,
                          editNote: reviewNote.trim() || null,
                          id: result.correction.editId,
                        },
                      ],
                correctionUpdatedAt: result.correction.updatedAt,
                proposedValue: result.correction.proposedValue,
                reviewNote: result.correction.reviewNote,
              }
            : item,
        ),
      );
    } catch (error) {
      setDecisionError(
        error instanceof Error
          ? error.message
          : "The correction edit could not be saved.",
      );
    } finally {
      setEditingCorrectionId(null);
    }
  }

  const typeFilteredCandidates = useMemo(() => {
    if (activeFilter === "all") {
      return candidates;
    }

    return candidates.filter(
      (candidate) => candidate.stepExecuted === activeFilter,
    );
  }, [activeFilter, candidates]);

  const workflowCounts = useMemo(() => {
    return Object.fromEntries(
      workflowFilters.map((filter) => [
        filter.value,
        typeFilteredCandidates.filter((candidate) =>
          matchesWorkflowFilter(candidate, filter.value),
        ).length,
      ]),
    ) as Record<WorkflowFilterValue, number>;
  }, [typeFilteredCandidates]);

  const filteredCandidates = useMemo(() => {
    return typeFilteredCandidates.filter((candidate) =>
      matchesWorkflowFilter(candidate, workflowFilter),
    );
  }, [typeFilteredCandidates, workflowFilter]);

  const selectedCandidate = useMemo(() => {
    if (selectedEventId === null) {
      return null;
    }

    return (
      candidates.find((candidate) => candidate.eventId === selectedEventId) ??
      null
    );
  }, [candidates, selectedEventId]);

  const metrics = useMemo(() => {
    const detected = candidates.length;
    const drafted = candidates.filter(
      (candidate) => candidate.stepExecuted === "create_correction_candidate",
    ).length;
    const evidence = candidates.filter(
      (candidate) => candidate.stepExecuted === "gather_evidence",
    ).length;
    const duplicates = candidates.filter(
      (candidate) => candidate.stepExecuted === "mark_duplicate",
    ).length;

    return { detected, drafted, duplicates, evidence };
  }, [candidates]);

  const totalExposure = useMemo(() => {
    return candidates.reduce(
      (sum, candidate) =>
        sum + Math.abs(Number(candidate.ledger?.amount ?? 0)),
      0,
    );
  }, [candidates]);

  return (
    <>
      <section className="grid gap-4 md:grid-cols-4">
        <CorrectionStat label="Detected" value={metrics.detected} />
        <CorrectionStat label="Drafted" value={metrics.drafted} />
        <CorrectionStat label="Evidence" value={metrics.evidence} />
        <CorrectionStat label="Duplicates" value={metrics.duplicates} />
      </section>

      <section className="rounded-lg border border-[#c8d3d1] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#102522]">
              Correction candidates
            </h2>
            <p className="mt-1 text-sm text-[#63716f]">
              Agent remediation work from correction, evidence, and duplicate
              telemetry.
            </p>
          </div>
          <span className="w-fit rounded-full border border-[#dbe3e1] bg-[#f8fbfa] px-3 py-1 text-xs font-semibold text-[#526260]">
            {status === "loading" ? "loading candidates" : `${filteredCandidates.length} visible`}
          </span>
        </div>

        <div className="mt-5 grid gap-4">
          <FilterRow label="Workflow">
            {workflowFilters.map((filter) => {
              const isActive = workflowFilter === filter.value;

              return (
                <FilterButton
                  active={isActive}
                  count={workflowCounts[filter.value]}
                  key={filter.value}
                  label={filter.label}
                  onClick={() => setWorkflowFilter(filter.value)}
                />
              );
            })}
          </FilterRow>
        </div>

        {status === "error" ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {errorMessage ?? "Corrections could not be loaded."}
          </div>
        ) : null}

        {decisionError ? (
          <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {decisionError}
          </div>
        ) : null}

        {status === "loading" ? (
          <div className="mt-5">
            <TableSkeleton columns={8} rows={5} />
          </div>
        ) : null}

        {status === "ready" ? (
          <div className="mt-5 overflow-x-auto rounded-lg border border-[#dbe3e1]">
            <div className="grid min-w-[1310px] grid-cols-[110px_minmax(240px,1fr)_170px_minmax(240px,1fr)_140px_130px_180px_92px] place-items-center bg-[#f4f7f6] py-3 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[#63716f] [&>*]:flex [&>*]:h-full [&>*]:w-full [&>*]:items-center [&>*]:justify-center [&>*]:px-4 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#dbe3e1]">
              <span>Ledger</span>
              <span>Candidate</span>
              <span>Type</span>
              <span>Evidence</span>
              <span>Confidence</span>
              <span>Amount</span>
              <span>Human decision</span>
              <span>Detail</span>
            </div>
            <div className="grid min-w-[1310px] grid-cols-[110px_minmax(240px,1fr)_170px_minmax(240px,1fr)_140px_130px_180px_92px] place-items-center border-t border-[#dbe3e1] bg-[#fbfcfc] py-2.5 text-center [&>*]:flex [&>*]:h-full [&>*]:w-full [&>*]:items-center [&>*]:justify-center [&>*]:px-4 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#dbe3e1]">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#63716f]">
                Filters
              </span>
              <span aria-hidden="true" />
              <div>
                <div className="dropdown-control w-full">
                  <select
                    aria-label="Filter correction candidates by work type"
                    className="h-9 w-full rounded-md border border-[#c8d3d1] bg-white px-2 text-sm font-semibold text-[#2b3d3a] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    onChange={(event) =>
                      setActiveFilter(event.target.value as FilterValue)
                    }
                    value={activeFilter}
                  >
                    {filters.map((filter) => (
                      <option key={filter.value} value={filter.value}>
                        {filter.value === "all" ? "All work types" : filter.label}
                      </option>
                    ))}
                  </select>
                  <DropdownIndicator />
                </div>
              </div>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </div>
            <div className="divide-y divide-[#dbe3e1]">
              {filteredCandidates.length > 0 ? (
                filteredCandidates.map((candidate) => (
                  <CorrectionCandidateRow
                    candidate={candidate}
                    executing={
                      candidate.correctionId !== null &&
                      executingCorrectionId === candidate.correctionId
                    }
                    key={candidate.eventId}
                    onDecision={(decision) => saveDecision(candidate, decision)}
                    onExecute={() => executeCorrection(candidate)}
                    onOpen={() => setSelectedEventId(candidate.eventId)}
                    saving={savingEventId === candidate.eventId}
                  />
                ))
              ) : (
                <div className="min-w-[1310px] bg-white px-4 py-10 text-center text-sm text-[#63716f]">
                  No candidates match the selected work type and workflow.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      {selectedCandidate?.ledger ? (
        <LedgerDetailModal
          correction={
            selectedCandidate.correctionId
              ? {
                  appliedAt: selectedCandidate.correctionAppliedAt,
                  beforeValue: selectedCandidate.beforeValue,
                  confidenceScore: selectedCandidate.confidenceScore,
                  createdAt: selectedCandidate.correctionCreatedAt,
                  decision: selectedCandidate.decision,
                  decisionRecordedAt: selectedCandidate.decisionRecordedAt,
                  edits: selectedCandidate.correctionEdits,
                  evidence: selectedCandidate.evidence,
                  executionError: selectedCandidate.executionError,
                  executionStatus: selectedCandidate.executionStatus,
                  hypothesis: selectedCandidate.hypothesis,
                  id: selectedCandidate.correctionId,
                  proposedValue: selectedCandidate.proposedValue,
                  rationale: selectedCandidate.correctionRationale,
                  requiredEvidence: selectedCandidate.correctionEvidence,
                  reviewNote: selectedCandidate.reviewNote,
                  targetColumn: selectedCandidate.targetColumn,
                  updatedAt: selectedCandidate.correctionUpdatedAt,
                }
              : undefined
          }
          correctionBusy={
            selectedCandidate.correctionId !== null &&
            editingCorrectionId === selectedCandidate.correctionId
              ? "edit"
              : savingEventId === selectedCandidate.eventId
              ? "decision"
              : selectedCandidate.correctionId !== null &&
                  executingCorrectionId === selectedCandidate.correctionId
                ? "execution"
                : null
          }
          correctionError={decisionError}
          correctionUnavailable={
            selectedCandidate.stepExecuted === "create_correction_candidate" &&
            selectedCandidate.correctionId === null
          }
          onClose={() => setSelectedEventId(null)}
          onCorrectionDecision={(decision, reviewNote) =>
            saveDecision(selectedCandidate, decision, reviewNote)
          }
          onCorrectionExecute={() => executeCorrection(selectedCandidate)}
          onCorrectionEdit={(proposedStatus, reviewNote) =>
            saveCorrectionEdit(selectedCandidate, proposedStatus, reviewNote)
          }
          row={selectedCandidate.ledger}
          totalExposure={totalExposure}
        />
      ) : null}
    </>
  );
}

function CorrectionCandidateRow({
  candidate,
  executing,
  onDecision,
  onExecute,
  onOpen,
  saving,
}: {
  candidate: CorrectionCandidate;
  executing: boolean;
  onDecision: (decision: CorrectionDecision) => void;
  onExecute: () => void;
  onOpen: () => void;
  saving: boolean;
}) {
  const ledger = candidate.ledger;
  const stepStyle =
    stepStyles[candidate.stepExecuted] ??
    "border-slate-200 bg-slate-50 text-slate-700";
  const canExecute =
    candidate.decision === "approved" &&
    candidate.correctionId !== null &&
    (candidate.executionStatus === "ready" ||
      candidate.executionStatus === "failed");
  const decisionLocked =
    candidate.decision !== null ||
    candidate.executionStatus === "applying" ||
    candidate.executionStatus === "applied";
  const isTelemetryOnlyCorrection =
    candidate.stepExecuted === "create_correction_candidate" &&
    candidate.correctionId === null;
  const isEditableProposal =
    candidate.correctionId !== null &&
    candidate.decision === null &&
    candidate.executionStatus === "not_ready";

  return (
    <article className="grid min-w-[1310px] grid-cols-[110px_minmax(240px,1fr)_170px_minmax(240px,1fr)_140px_130px_180px_92px] place-items-center bg-white py-4 text-center text-sm [&>*]:h-full [&>*]:w-full [&>*]:content-center [&>*]:px-4 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#e2e8e6]">
      <div>
        <p className="font-mono font-semibold text-[#2b3d3a]">
          {candidate.ledgerId ? `#${candidate.ledgerId}` : `event #${candidate.eventId}`}
        </p>
        <p className="mt-1 text-xs text-[#63716f]">
          {formatTime(candidate.timestamp)}
        </p>
      </div>
      <div>
        <p className="font-semibold leading-6 text-[#102522]">
          {candidate.hypothesis}
        </p>
        {candidate.correctionId ? (
          <p className="mt-1 font-mono text-xs font-semibold text-teal-800">
            {candidate.targetColumn}: {formatCorrectionValue(candidate.beforeValue)} to{" "}
            {formatCorrectionValue(candidate.proposedValue)}
          </p>
        ) : null}
        <p className="mt-1 line-clamp-2 text-[#63716f]">
          {ledger?.description ?? "No linked ledger row found."}
        </p>
      </div>
      <div className="flex items-center justify-center">
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${stepStyle}`}
        >
          {stepLabels[candidate.stepExecuted] ?? candidate.stepExecuted}
        </span>
      </div>
      <p className="line-clamp-3 leading-6 text-[#63716f]">
        {candidate.evidence}
      </p>
      <ConfidenceMeter value={candidate.confidenceScore} />
      <p className="font-semibold text-[#102522]">
        {currencyFormatter.format(Number(ledger?.amount ?? 0))}
      </p>
      <div className="w-full">
        {isTelemetryOnlyCorrection ? (
          <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            No proposal
          </span>
        ) : (
          <div className="dropdown-control">
            <select
              aria-label={`Human decision for correction event ${candidate.eventId}`}
              className={`w-full rounded-md border bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-60 ${
                candidate.decision === "approved"
                  ? "border-emerald-300 text-emerald-800"
                  : candidate.decision === "rejected"
                    ? "border-rose-300 text-rose-800"
                    : "border-[#c8d3d1] text-[#2b3d3a]"
              }`}
              disabled={!ledger || saving || executing || decisionLocked}
              onChange={(event) => {
                const decision = event.target.value as CorrectionDecision | "";

                if (decision) {
                  onDecision(decision);
                }
              }}
              value={candidate.decision ?? ""}
            >
              <option value="">Select decision</option>
              <option value="approved">Approve correction</option>
              <option value="rejected">Reject correction</option>
            </select>
            <DropdownIndicator />
          </div>
        )}
        <p className="mt-1 min-h-4 text-xs text-[#63716f]">
          {isTelemetryOnlyCorrection
            ? "Telemetry only"
            : saving
              ? "Saving..."
              : executing || candidate.executionStatus === "applying"
                ? "Applying..."
                : candidate.executionStatus === "applied"
                  ? "Applied"
                  : candidate.executionStatus === "failed"
                    ? "Execution failed"
                    : candidate.decisionRecordedAt
                      ? formatTime(candidate.decisionRecordedAt)
                      : "Awaiting review"}
        </p>
        {canExecute ? (
          <button
            className="mt-2 h-9 w-full rounded-md bg-[#102522] px-3 text-xs font-semibold text-white transition hover:bg-[#1c3b36] disabled:cursor-wait disabled:opacity-60"
            disabled={executing}
            onClick={onExecute}
            title={`Apply allowlisted ${candidate.targetColumn ?? "correction"} change`}
            type="button"
          >
            {executing
              ? "Applying..."
              : candidate.executionStatus === "failed"
                ? "Retry apply"
                : "Apply correction"}
          </button>
        ) : null}
        {candidate.executionError ? (
          <p className="mt-1 line-clamp-2 text-xs text-rose-700">
            {candidate.executionError}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-center">
        <button
          className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ledger}
          onClick={onOpen}
          type="button"
        >
          {isEditableProposal ? "Edit" : "Detail"}
        </button>
      </div>
    </article>
  );
}

function FilterRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-[#63716f]">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
        active
          ? "border-[#102522] bg-[#102522] text-white"
          : "border-[#dbe3e1] bg-[#f8fbfa] text-[#526260] hover:border-teal-300 hover:text-[#102522]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      {count !== undefined ? (
        <span
          className={`inline-flex min-w-6 justify-center rounded-full px-1.5 py-0.5 text-xs ${
            active
              ? "bg-white/15 text-white"
              : "bg-[#e7eeec] text-[#526260]"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function matchesWorkflowFilter(
  candidate: CorrectionCandidate,
  filter: WorkflowFilterValue,
) {
  switch (filter) {
    case "awaiting_review":
      return (
        candidate.correctionId !== null &&
        candidate.decision === null &&
        candidate.executionStatus === "not_ready"
      );
    case "ready_to_apply":
      return (
        candidate.correctionId !== null &&
        candidate.decision === "approved" &&
        candidate.executionStatus === "ready"
      );
    case "applied":
      return candidate.executionStatus === "applied";
    case "rejected":
      return (
        candidate.decision === "rejected" ||
        candidate.executionStatus === "cancelled"
      );
    case "failed":
      return candidate.executionStatus === "failed";
    case "telemetry_only":
      return candidate.correctionId === null;
    case "all":
      return true;
  }
}

function ConfidenceMeter({ value }: { value: number }) {
  return (
    <div className="mx-auto min-w-28">
      <div className="flex items-center justify-between gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#dbe3e1]">
          <div
            className="h-full rounded-full bg-teal-500"
            style={{ width: `${Math.round(value * 100)}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-[#102522]">
          {Math.round(value * 100)}%
        </span>
      </div>
    </div>
  );
}

function CorrectionStat({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-lg border border-[#c8d3d1] bg-white p-5 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#63716f]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-[#102522]">{value}</p>
    </article>
  );
}

function formatTime(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "pending";
}

function formatCorrectionValue(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}
