"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErpLedgerRow } from "@/lib/ledger/use-ledger-rows";

type LedgerDetailDecision = {
  actionLabel: string;
  note: string;
};

export type LedgerCorrectionDetail = {
  appliedAt: string | null;
  beforeValue: unknown;
  confidenceScore: number;
  createdAt: string | null;
  decision: "approved" | "rejected" | null;
  decisionRecordedAt: string | null;
  edits: LedgerCorrectionEdit[];
  evidence: string;
  executionError: string | null;
  executionStatus:
    | "not_ready"
    | "ready"
    | "applying"
    | "applied"
    | "failed"
    | "cancelled"
    | null;
  hypothesis: string;
  id: number;
  proposedValue: unknown;
  rationale: string | null;
  requiredEvidence: unknown;
  reviewNote: string | null;
  targetColumn: string | null;
  updatedAt: string | null;
};

export type LedgerCorrectionEdit = {
  afterValue: unknown;
  beforeValue: unknown;
  createdAt: string;
  editNote: string | null;
  id: number;
};

type LedgerDetailModalProps = {
  correction?: LedgerCorrectionDetail;
  correctionBusy?: "decision" | "edit" | "execution" | null;
  correctionError?: string | null;
  correctionUnavailable?: boolean;
  decision?: LedgerDetailDecision;
  onClose: () => void;
  onCorrectionDecision?: (
    decision: "approved" | "rejected",
    reviewNote: string,
  ) => Promise<void>;
  onCorrectionExecute?: () => Promise<void>;
  onCorrectionEdit?: (
    proposedStatus: string,
    reviewNote: string,
  ) => Promise<void>;
  initialPrompt?: string;
  row: ErpLedgerRow;
  totalExposure?: number;
};

type PromptEvent = {
  id: number;
  ledger_id: number;
  event_type: string;
  human_prompt: string | null;
  agent_response: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  telemetry_id: number | null;
  error_message: string | null;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const eventTypeLabels: Record<string, string> = {
  agent_response: "Agent response",
  evidence_request: "Evidence request",
  human_approval: "Human approval",
  human_rejection: "Human rejection",
  prompt_rerun: "Prompt rerun",
};

const eventStatusLabels: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  protocol_blocked: "Protocol blocked",
  queued: "Queued",
  thinking: "Thinking",
};

const eventStatusStyles: Record<string, string> = {
  completed: "border-teal-300/30 bg-teal-300/10 text-teal-100",
  failed: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  protocol_blocked: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  queued: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  thinking: "border-sky-300/30 bg-sky-300/10 text-sky-100",
};

const protocolErrorMessages: Record<string, string> = {
  EVIDENCE_RESPONSE_NOT_OBJECT:
    "The agent returned evidence in an unsupported format, so the protocol stopped the response.",
  INVALID_CONFIDENCE_SCORE:
    "The agent returned an invalid confidence score, so the protocol stopped the response.",
  INVALID_EVIDENCE_NEEDED:
    "The agent did not return a valid evidence list, so the protocol stopped the response.",
  INVALID_PROTOCOL_ACTION:
    "The agent requested an action outside the permitted protocol boundary.",
  MISSING_ANSWER:
    "The agent did not provide the required answer, so the protocol stopped the response.",
  MISSING_FALSIFICATION_TEST:
    "The agent omitted the required verification test, so the protocol stopped the response.",
  MISSING_HYPOTHESIS:
    "The agent omitted the required hypothesis, so the protocol stopped the response.",
  MODEL_RESPONSE_MISSING_CHOICES:
    "The model returned no usable response choice, so the protocol stopped the response.",
  MODEL_RESPONSE_MISSING_CONTENT:
    "The model returned an empty response, so the protocol stopped it.",
  MODEL_RESPONSE_MISSING_MESSAGE:
    "The model response did not contain the required message structure.",
  MODEL_RETURNED_NON_JSON_EVIDENCE_RESPONSE:
    "The agent returned evidence outside the required structured format.",
  MODEL_RETURNED_NON_JSON_PROMPT_RESPONSE:
    "The agent returned an answer outside the required structured format.",
  PROMPT_RESPONSE_NOT_OBJECT:
    "The agent response did not match the required structured format.",
};

const correctionStatusOptions = [
  "pending",
  "review",
  "approved",
  "duplicate",
] as const;

export function LedgerDetailModal({
  correction,
  correctionBusy = null,
  correctionError,
  correctionUnavailable = false,
  decision,
  initialPrompt = "",
  onClose,
  onCorrectionDecision,
  onCorrectionEdit,
  onCorrectionExecute,
  row,
  totalExposure,
}: LedgerDetailModalProps) {
  const closeTimerRef = useRef<number | null>(null);
  const isClosingRef = useRef(false);
  const [events, setEvents] = useState<PromptEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsStatus, setEventsStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [isThinking, setIsThinking] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [reviewNote, setReviewNote] = useState(correction?.reviewNote ?? "");
  const exposure = totalExposure ?? Math.abs(Number(row.amount ?? 0));

  useEffect(() => {
    setReviewNote(correction?.reviewNote ?? "");
  }, [correction?.id, correction?.reviewNote]);

  const closeModal = useCallback(() => {
    if (isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    setIsClosing(true);
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    closeTimerRef.current = window.setTimeout(
      onClose,
      prefersReducedMotion ? 0 : 220,
    );
  }, [onClose]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeModal]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPromptEvents() {
      setEventsStatus("loading");
      setEventsError(null);

      try {
        const response = await fetch(
          `/internal-api/ledger-agent-prompt-events?ledgerId=${row.id}`,
        );
        const result = (await response.json()) as
          | { events: PromptEvent[] }
          | { error: string };

        if (!response.ok || "error" in result) {
          throw new Error("error" in result ? result.error : "Load failed.");
        }

        if (isMounted) {
          setEvents(result.events);
          setEventsStatus("ready");
        }
      } catch (error) {
        if (isMounted) {
          setEventsError(
            error instanceof Error
              ? error.message
              : "Prompt events could not be loaded.",
          );
          setEventsStatus("error");
        }
      }
    }

    loadPromptEvents();

    return () => {
      isMounted = false;
    };
  }, [correction?.decisionRecordedAt, correction?.executionStatus, row.id]);

  useEffect(() => {
    setReviewNote(correction?.reviewNote ?? "");
  }, [correction?.id, correction?.reviewNote]);

  async function sendPrompt() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isThinking) {
      return;
    }

    setIsThinking(true);
    setEventsError(null);

    try {
      const response = await fetch("/internal-api/ledger-agent-prompt-events", {
        body: JSON.stringify({
          eventType: "prompt_rerun",
          humanPrompt: trimmedPrompt,
          ledgerId: row.id,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json()) as
        | { event: PromptEvent }
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Prompt failed.");
      }

      setEvents((currentEvents) => [result.event, ...currentEvents]);
      setPrompt("");
      setEventsStatus("ready");
    } catch (error) {
      setEventsError(
        error instanceof Error
          ? error.message
          : "Prompt could not be sent to the agent.",
      );
      setEventsStatus("error");
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className={`fixed inset-0 z-50 flex justify-end bg-[#102522]/18 ${
        isClosing
          ? "ledger-detail-backdrop-out"
          : "ledger-detail-backdrop-in"
      }`}
      role="dialog"
    >
      <button
        aria-label="Close ledger detail"
        className="absolute inset-0 cursor-default"
        onClick={closeModal}
        type="button"
      />
      <aside
        className={`relative flex h-full w-full max-w-[520px] flex-col border-l border-[#c8d3d1] bg-[#102522] p-5 text-white shadow-2xl ${
          isClosing ? "ledger-detail-panel-out" : "ledger-detail-panel-in"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-200">
              {correction || correctionUnavailable
                ? "Correction Detail"
                : "Review Detail"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Ledger #{row.id}</h2>
          </div>
          <button
            className="grid size-9 place-items-center rounded-md border border-white/12 bg-white/[0.06] text-lg leading-none text-[#d3dddb] transition hover:bg-white/12 hover:text-white"
            onClick={closeModal}
            type="button"
          >
            x
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="rounded-lg border border-white/12 bg-white/[0.06] p-4">
            <p className="text-sm font-semibold leading-6 text-white">
              {row.description ?? "Untitled ledger entry"}
            </p>
            <p className="mt-3 text-sm leading-6 text-[#d3dddb]">
              {row.optimization_notes ??
                "No optimizer notes are recorded for this ledger yet."}
            </p>
          </div>

          <div className="mt-5 grid gap-3 text-sm">
            <DetailLine
              label="Total exposure"
              value={currencyFormatter.format(exposure)}
            />
            <DetailLine label="Selected status" value={row.status ?? "pending"} />
            <DetailLine
              label="Selected owner"
              value={row.department ?? "Unassigned"}
            />
            <DetailLine
              label="Amount"
              value={currencyFormatter.format(Number(row.amount ?? 0))}
            />
          </div>

          {correction ? (
            <CorrectionWorkflow
              busy={correctionBusy}
              correction={correction}
              errorMessage={correctionError}
              onDecision={onCorrectionDecision}
              onEdit={onCorrectionEdit}
              onExecute={onCorrectionExecute}
              onReviewNoteChange={setReviewNote}
              reviewNote={reviewNote}
            />
          ) : null}

          {correctionUnavailable ? (
            <section className="mt-6 border-t border-white/12 pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
                Telemetry only
              </p>
              <h3 className="mt-1 text-lg font-semibold text-white">
                No editable proposal was recorded
              </h3>
              <p className="mt-3 rounded-lg border border-amber-200/20 bg-amber-200/[0.06] p-4 text-sm leading-6 text-[#d3dddb]">
                This legacy event recorded the agent&apos;s correction analysis,
                but it did not include a database value that can be reviewed or
                edited.
              </p>
            </section>
          ) : null}

          <div className="mt-6">
            <p className="text-sm font-semibold text-white">Ask agent</p>
            <textarea
              className="mt-3 min-h-28 w-full resize-none rounded-lg border border-white/12 bg-white/[0.08] p-3 text-sm leading-6 text-white outline-none transition placeholder:text-[#9fb0ad] focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20"
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask the agent to explain, gather evidence, or rerun protocol for this ledger..."
              value={prompt}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-[#b8c8c5]">
                Ledger #{row.id} context will travel with the prompt.
              </p>
              <button
                className="rounded-md bg-teal-200 px-3 py-2 text-sm font-semibold text-[#102522] transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!prompt.trim() || isThinking}
                onClick={sendPrompt}
                type="button"
              >
                {isThinking ? "Thinking..." : "Send"}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/12 bg-white/[0.06] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Agent response</p>
              {isThinking ? (
                <span className="rounded-full border border-teal-300/40 bg-teal-300/10 px-3 py-1 text-xs font-semibold text-teal-100">
                  Thinking...
                </span>
              ) : null}
            </div>
            <PromptEventHistory
              errorMessage={eventsError}
              events={events}
              isThinking={isThinking}
              status={eventsStatus}
            />
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold text-white">Staged response</p>
            {decision ? (
              <div className="mt-3 rounded-lg border border-white/12 bg-white/[0.06] p-3 text-sm">
                <p className="font-semibold text-white">
                  {decision.actionLabel}
                </p>
                <p className="mt-1 text-[#c7d8d4]">{decision.note}</p>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-white/12 bg-white/[0.06] p-3 text-sm text-[#d3dddb]">
                No human response staged for this ledger yet.
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CorrectionWorkflow({
  busy,
  correction,
  errorMessage,
  onDecision,
  onEdit,
  onExecute,
  onReviewNoteChange,
  reviewNote,
}: {
  busy: "decision" | "edit" | "execution" | null;
  correction: LedgerCorrectionDetail;
  errorMessage?: string | null;
  onDecision?: (
    decision: "approved" | "rejected",
    reviewNote: string,
  ) => Promise<void>;
  onEdit?: (proposedStatus: string, reviewNote: string) => Promise<void>;
  onExecute?: () => Promise<void>;
  onReviewNoteChange: (value: string) => void;
  reviewNote: string;
}) {
  const [proposedStatus, setProposedStatus] = useState(
    correctionValueAsString(correction.proposedValue),
  );
  const decisionLocked =
    correction.decision !== null ||
    correction.executionStatus === "applying" ||
    correction.executionStatus === "applied";
  const canExecute =
    correction.decision === "approved" &&
    (correction.executionStatus === "ready" ||
      correction.executionStatus === "failed");
  const canEdit =
    correction.decision === null &&
    correction.executionStatus === "not_ready" &&
    correction.targetColumn === "status" &&
    onEdit !== undefined;
  const persistedStatus = correctionValueAsString(correction.proposedValue);
  const beforeStatus = correctionValueAsString(correction.beforeValue);
  const hasUnsavedEdit = canEdit && proposedStatus !== persistedStatus;
  const proposedStatusIsValid =
    proposedStatus.length > 0 && proposedStatus !== beforeStatus;

  useEffect(() => {
    setProposedStatus(correctionValueAsString(correction.proposedValue));
  }, [correction.id, correction.proposedValue]);

  return (
    <section className="mt-6 border-t border-white/12 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-200">
            Correction #{correction.id}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-white">
            Proposed database change
          </h3>
        </div>
        <span className="rounded-full border border-teal-300/30 bg-teal-300/10 px-3 py-1 text-xs font-semibold text-teal-100">
          {Math.round(correction.confidenceScore * 100)}% confidence
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border border-white/12 bg-white/[0.06] p-4 text-center">
        <div className="min-w-0">
          <p className="text-xs uppercase text-[#9fb0ad]">Current</p>
          <p className="mt-2 break-words font-mono text-sm font-semibold text-white">
            {formatDetailValue(correction.beforeValue)}
          </p>
        </div>
        <span className="text-[#9fb0ad]">to</span>
        <div className="min-w-0">
          <p className="text-xs uppercase text-[#9fb0ad]">Proposed</p>
          {canEdit ? (
            <select
              aria-label="Proposed ledger status"
              className="mt-2 h-10 w-full rounded-md border border-teal-300/30 bg-[#18312d] px-2 text-center font-mono text-sm font-semibold text-teal-100 outline-none transition focus:border-teal-200 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
              disabled={busy !== null}
              onChange={(event) => setProposedStatus(event.target.value)}
              value={proposedStatus}
            >
              {correctionStatusOptions.map((status) => (
                <option disabled={status === beforeStatus} key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-2 break-words font-mono text-sm font-semibold text-teal-100">
              {formatDetailValue(correction.proposedValue)}
            </p>
          )}
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-xs text-[#b8c8c5]">
        erp_ledger.{correction.targetColumn ?? "unknown"}
      </p>

      {canEdit && onEdit ? (
        <button
          className="mt-3 h-10 w-full rounded-md border border-teal-300/40 bg-teal-300/10 px-3 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/20 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            busy !== null || !hasUnsavedEdit || !proposedStatusIsValid
          }
          onClick={() => onEdit(proposedStatus, reviewNote)}
          type="button"
        >
          {busy === "edit" ? "Saving proposal..." : "Save proposal edit"}
        </button>
      ) : null}

      <div className="mt-5 space-y-4 text-sm">
        <CorrectionNarrative label="Hypothesis" value={correction.hypothesis} />
        <CorrectionNarrative label="Falsification test" value={correction.evidence} />
        <CorrectionNarrative
          label="Required evidence"
          value={formatEvidence(correction.requiredEvidence)}
        />
        <CorrectionNarrative
          label="Protocol rationale"
          value={correction.rationale ?? "No rationale was recorded."}
        />
      </div>

      <div className="mt-5 grid gap-3 text-sm">
        <DetailLine
          label="Review status"
          value={correction.decision ?? "pending"}
        />
        <DetailLine
          label="Execution status"
          value={correction.executionStatus ?? "legacy"}
        />
        <DetailLine
          label="Proposed"
          value={formatDetailTime(correction.createdAt)}
        />
        {correction.decisionRecordedAt ? (
          <DetailLine
            label="Reviewed"
            value={formatDetailTime(correction.decisionRecordedAt)}
          />
        ) : null}
        {correction.appliedAt ? (
          <DetailLine
            label="Applied"
            value={formatDetailTime(correction.appliedAt)}
          />
        ) : null}
      </div>

      <CorrectionTimeline correction={correction} />

      {correction.executionError ? (
        <p className="mt-4 rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm leading-6 text-rose-100">
          {correction.executionError}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-4 rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm leading-6 text-rose-100">
          {errorMessage}
        </p>
      ) : null}

      {onDecision ? (
        <div className="mt-5">
          <label className="text-sm font-semibold text-white" htmlFor="correction-review-note">
            Human review note
          </label>
          <textarea
            className="mt-3 min-h-24 w-full resize-y rounded-lg border border-white/12 bg-white/[0.08] p-3 text-sm leading-6 text-white outline-none transition placeholder:text-[#9fb0ad] focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20 disabled:opacity-60"
            disabled={decisionLocked || busy !== null || hasUnsavedEdit}
            id="correction-review-note"
            maxLength={500}
            onChange={(event) => onReviewNoteChange(event.target.value)}
            placeholder="Optional context for this decision"
            value={reviewNote}
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              className="h-10 rounded-md border border-rose-300/40 bg-rose-300/10 px-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={decisionLocked || busy !== null || hasUnsavedEdit}
              onClick={() => onDecision("rejected", reviewNote)}
              type="button"
            >
              {busy === "decision" ? "Saving..." : "Reject"}
            </button>
            <button
              className="h-10 rounded-md bg-teal-200 px-3 text-sm font-semibold text-[#102522] transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={decisionLocked || busy !== null || hasUnsavedEdit}
              onClick={() => onDecision("approved", reviewNote)}
              type="button"
            >
              {busy === "decision" ? "Saving..." : "Approve"}
            </button>
          </div>
        </div>
      ) : null}

      {canExecute && onExecute ? (
        <button
          className="mt-3 h-11 w-full rounded-md border border-teal-200 bg-transparent px-4 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/10 disabled:cursor-wait disabled:opacity-50"
          disabled={busy !== null}
          onClick={onExecute}
          type="button"
        >
          {busy === "execution"
            ? "Applying correction..."
            : correction.executionStatus === "failed"
              ? "Retry constrained execution"
              : "Apply approved correction"}
        </button>
      ) : null}
    </section>
  );
}

function CorrectionTimeline({
  correction,
}: {
  correction: LedgerCorrectionDetail;
}) {
  const edits = [...correction.edits].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const initialProposedValue =
    edits[0]?.beforeValue ?? correction.proposedValue;
  const items: {
    detail: string;
    id: string;
    timestamp: string | null;
    title: string;
  }[] = [
    {
      detail: `${formatDetailValue(correction.beforeValue)} to ${formatDetailValue(initialProposedValue)}`,
      id: "proposed",
      timestamp: correction.createdAt,
      title: "Agent proposed correction",
    },
    ...edits.map((edit) => ({
      detail: `${formatDetailValue(edit.beforeValue)} to ${formatDetailValue(edit.afterValue)}${edit.editNote ? ` - ${edit.editNote}` : ""}`,
      id: `edit-${edit.id}`,
      timestamp: edit.createdAt,
      title: "Human edited proposal",
    })),
  ];

  if (correction.decision && correction.decisionRecordedAt) {
    items.push({
      detail:
        correction.decision === "approved"
          ? "Constrained execution authorized; no ledger mutation yet."
          : "Proposal closed without changing the ledger.",
      id: "decision",
      timestamp: correction.decisionRecordedAt,
      title:
        correction.decision === "approved"
          ? "Human approved correction"
          : "Human rejected correction",
    });
  }

  if (correction.appliedAt) {
    items.push({
      detail: `erp_ledger.${correction.targetColumn ?? "unknown"} changed from ${formatDetailValue(correction.beforeValue)} to ${formatDetailValue(correction.proposedValue)}.`,
      id: "applied",
      timestamp: correction.appliedAt,
      title: "Protocol applied correction",
    });
  } else if (correction.executionStatus === "failed") {
    items.push({
      detail:
        correction.executionError ?? "Constrained execution did not complete.",
      id: "failed",
      timestamp: correction.updatedAt,
      title: "Execution blocked",
    });
  }

  return (
    <section className="mt-6 border-t border-white/12 pt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-200">
        Audit timeline
      </p>
      <ol className="mt-4 border-l border-white/15 pl-5">
        {items.map((item) => (
          <li className="relative pb-5 last:pb-0" key={item.id}>
            <span className="absolute -left-[1.48rem] top-1 size-2 rounded-sm bg-teal-200" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <time className="text-xs text-[#9fb0ad]">
                {formatDetailTime(item.timestamp)}
              </time>
            </div>
            <p className="mt-1 text-sm leading-6 text-[#c7d8d4]">
              {item.detail}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CorrectionNarrative({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9fb0ad]">
        {label}
      </p>
      <p className="mt-1 leading-6 text-[#d3dddb]">{value}</p>
    </div>
  );
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined) {
    return "null";
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function correctionValueAsString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function formatEvidence(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return "No required evidence was recorded.";
  }

  return value.map((item) => formatDetailValue(item)).join(", ");
}

function formatDetailTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PromptEventHistory({
  errorMessage,
  events,
  isThinking,
  status,
}: {
  errorMessage: string | null;
  events: PromptEvent[];
  isThinking: boolean;
  status: "loading" | "ready" | "error";
}) {
  if (isThinking) {
    return (
      <p className="mt-3 text-sm leading-6 text-[#d3dddb]">
        The agent protocol is creating a ledger-specific prompt event.
      </p>
    );
  }

  if (status === "loading") {
    return (
      <p className="mt-3 text-sm leading-6 text-[#d3dddb]">
        Loading prompt history...
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="mt-3 rounded-md border border-rose-300/30 bg-rose-300/10 p-3 text-sm leading-6 text-rose-100">
        {errorMessage ?? "Prompt history could not be loaded."}
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <p className="mt-3 text-sm leading-6 text-[#d3dddb]">
        No agent response yet. Send a prompt to start a ledger-specific agent
        follow-up.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {events.map((event) => (
        <article
          className={`rounded-md border p-3 ${getEventCardStyle(event.status)}`}
          key={event.id}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-100">
              {eventTypeLabels[event.event_type] ?? humanizeCode(event.event_type)}
            </span>
            <span
              className={`rounded-full border px-2 py-1 text-xs font-semibold ${getEventStatusStyle(event.status)}`}
            >
              {eventStatusLabels[event.status] ?? humanizeCode(event.status)}
            </span>
          </div>
          {event.human_prompt ? (
            <p className="mt-3 text-sm leading-6 text-[#d3dddb]">
              {event.human_prompt}
            </p>
          ) : null}
          <EventOutcome event={event} />
        </article>
      ))}
    </div>
  );
}

function EventOutcome({ event }: { event: PromptEvent }) {
  if (event.agent_response) {
    return (
      <p className="mt-3 whitespace-pre-line text-sm font-semibold leading-6 text-white">
        {event.agent_response}
      </p>
    );
  }

  if (event.error_message) {
    const friendlyMessage = formatProtocolError(event.error_message);

    return (
      <div className="mt-3">
        <p className="text-sm font-semibold leading-6 text-white">
          {friendlyMessage}
        </p>
        <details className="mt-2 text-xs text-[#b8c8c5]">
          <summary className="cursor-pointer font-semibold text-[#d3dddb]">
            Technical reason
          </summary>
          <p className="mt-2 break-words font-mono leading-5">
            {event.error_message}
          </p>
        </details>
      </div>
    );
  }

  if (event.status === "completed") {
    return (
      <p className="mt-3 text-sm font-semibold leading-6 text-white">
        Human decision recorded. No agent response was required.
      </p>
    );
  }

  if (event.status === "thinking") {
    return (
      <p className="mt-3 text-sm font-semibold leading-6 text-sky-100">
        The agent is evaluating this ledger inside the protocol boundary.
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm font-semibold leading-6 text-[#d3dddb]">
      Waiting for the protocol to process this event.
    </p>
  );
}

function formatProtocolError(errorMessage: string) {
  const normalizedCode = errorMessage.trim().toUpperCase();
  const directMessage = protocolErrorMessages[normalizedCode];

  if (directMessage) {
    return directMessage;
  }

  const quotedReason = errorMessage.match(/by '([^']+)'/i)?.[1];

  if (quotedReason) {
    return (
      protocolErrorMessages[quotedReason.toUpperCase()] ??
      `The agent response violated protocol: ${humanizeCode(quotedReason)}.`
    );
  }

  return "The agent run could not be completed. Review the technical reason below.";
}

function getEventCardStyle(status: string) {
  if (status === "protocol_blocked") {
    return "border-amber-300/25 bg-amber-300/[0.06]";
  }

  if (status === "failed") {
    return "border-rose-300/25 bg-rose-300/[0.06]";
  }

  return "border-white/12 bg-white/[0.06]";
}

function getEventStatusStyle(status: string) {
  return (
    eventStatusStyles[status] ??
    "border-white/12 bg-white/10 text-[#d3dddb]"
  );
}

function humanizeCode(value: string) {
  const words = value.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/12 pb-3">
      <span className="text-[#b8c8c5]">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}
