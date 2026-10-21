import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRequest as supabaseRequest } from "@/lib/supabase/server";

type CorrectionDecision = "approved" | "rejected";

type AgentTelemetryRow = {
  confidence_score: string | number | null;
  falsification_test: string | null;
  hypothesis: string | null;
  id: number;
  ledger_id: number | null;
  step_executed: string | null;
  timestamp: string | null;
};

type LedgerRow = {
  amount: string | number | null;
  department: string | null;
  description: string | null;
  id: number;
  optimization_notes: string | null;
  status: string | null;
  transaction_date: string | null;
};

type CorrectionDecisionEvent = {
  created_at: string;
  event_type: "human_approval" | "human_rejection";
  id: number;
  ledger_id: number;
  status: string;
  telemetry_id: number | null;
};

type CorrectionProposalRow = {
  applied_at: string | null;
  before_value: unknown;
  created_at: string;
  evidence: unknown;
  execution_error: string | null;
  execution_status:
    | "not_ready"
    | "ready"
    | "applying"
    | "applied"
    | "failed"
    | "cancelled";
  id: number;
  proposed_value: unknown;
  rationale: string;
  review_note: string | null;
  review_status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  target_column: string;
  telemetry_id: number | null;
  updated_at: string;
};

type CorrectionEditRow = {
  after_proposed_value: unknown;
  before_proposed_value: unknown;
  correction_id: number;
  created_at: string;
  edit_note: string | null;
  id: number;
};

type CorrectionRpcResult = {
  code: string;
  correction_id?: number;
  decision_event_id?: number;
  edit_id?: number;
  execution_status?: CorrectionProposalRow["execution_status"];
  message?: string;
  ok: boolean;
  proposed_value?: unknown;
  review_note?: string | null;
  review_status?: CorrectionProposalRow["review_status"];
  reviewed_at?: string;
  updated_at?: string;
};

const correctionSteps = [
  "create_correction_candidate",
  "gather_evidence",
  "mark_duplicate",
] as const;

const allowedCorrectionStatuses = new Set([
  "pending",
  "review",
  "approved",
  "duplicate",
]);

export const runtime = "nodejs";

export async function GET() {
  try {
    const telemetry = await supabaseRequest<AgentTelemetryRow[]>(
      `/rest/v1/agent_telemetry?select=id,ledger_id,timestamp,hypothesis,falsification_test,confidence_score,step_executed&step_executed=in.(${correctionSteps.join(",")})&order=timestamp.desc&limit=100`,
    );
    const ledgerIds = Array.from(
      new Set(
        telemetry
          .map((row) => row.ledger_id)
          .filter((ledgerId): ledgerId is number => typeof ledgerId === "number"),
      ),
    );
    const ledgers =
      ledgerIds.length > 0
        ? await supabaseRequest<LedgerRow[]>(
            `/rest/v1/erp_ledger?select=id,transaction_date,description,amount,department,status,optimization_notes&id=in.(${ledgerIds.join(",")})`,
          )
        : [];
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
    const telemetryIds = telemetry.map((event) => event.id);
    const correctionProposals = await loadCorrectionProposals(telemetryIds);
    const correctionEdits = await loadCorrectionEdits(
      correctionProposals.map((proposal) => proposal.id),
    );
    const editsByCorrectionId = new Map<number, CorrectionEditRow[]>();

    for (const edit of correctionEdits) {
      const edits = editsByCorrectionId.get(edit.correction_id) ?? [];
      edits.push(edit);
      editsByCorrectionId.set(edit.correction_id, edits);
    }
    const proposalByTelemetryId = new Map(
      correctionProposals
        .filter(
          (proposal): proposal is CorrectionProposalRow & { telemetry_id: number } =>
            proposal.telemetry_id !== null,
        )
        .map((proposal) => [proposal.telemetry_id, proposal]),
    );
    const decisionEvents =
      telemetryIds.length > 0
        ? await supabaseRequest<CorrectionDecisionEvent[]>(
            `/rest/v1/ledger_agent_prompt_events?select=id,ledger_id,event_type,status,created_at,telemetry_id&telemetry_id=in.(${telemetryIds.join(",")})&event_type=in.(human_approval,human_rejection)&order=created_at.desc`,
          )
        : [];
    const latestDecisionByTelemetryId = new Map<
      number,
      CorrectionDecisionEvent
    >();

    for (const decisionEvent of decisionEvents) {
      if (
        decisionEvent.telemetry_id !== null &&
        !latestDecisionByTelemetryId.has(decisionEvent.telemetry_id)
      ) {
        latestDecisionByTelemetryId.set(
          decisionEvent.telemetry_id,
          decisionEvent,
        );
      }
    }

    return NextResponse.json({
      corrections: telemetry.map((event) => {
        const decisionEvent = latestDecisionByTelemetryId.get(event.id);
        const proposal = proposalByTelemetryId.get(event.id);
        const proposalDecision = decisionFromReviewStatus(
          proposal?.review_status,
        );

        return {
          confidenceScore: normalizeConfidence(event.confidence_score),
          correctionAppliedAt: proposal?.applied_at ?? null,
          correctionCreatedAt: proposal?.created_at ?? null,
          correctionEdits: proposal
            ? (editsByCorrectionId.get(proposal.id) ?? []).map((edit) => ({
                afterValue: edit.after_proposed_value,
                beforeValue: edit.before_proposed_value,
                createdAt: edit.created_at,
                editNote: edit.edit_note,
                id: edit.id,
              }))
            : [],
          correctionEvidence: proposal?.evidence ?? [],
          correctionId: proposal?.id ?? null,
          correctionRationale: proposal?.rationale ?? null,
          correctionUpdatedAt: proposal?.updated_at ?? null,
          decision:
            proposalDecision ??
            (decisionEvent
              ? decisionFromEventType(decisionEvent.event_type)
              : null),
          decisionEventId: decisionEvent?.id ?? null,
          decisionRecordedAt:
            proposal?.reviewed_at ?? decisionEvent?.created_at ?? null,
          eventId: event.id,
          evidence: event.falsification_test ?? "No evidence test recorded.",
          executionError: proposal?.execution_error ?? null,
          executionStatus: proposal?.execution_status ?? null,
          hypothesis: event.hypothesis ?? "No correction hypothesis recorded.",
          ledger: event.ledger_id
            ? ledgerById.get(event.ledger_id) ?? null
            : null,
          ledgerId: event.ledger_id,
          proposedValue: proposal?.proposed_value ?? null,
          reviewNote: proposal?.review_note ?? null,
          stepExecuted: event.step_executed ?? "step_pending",
          targetColumn: proposal?.target_column ?? null,
          timestamp: event.timestamp,
          beforeValue: proposal?.before_value ?? null,
        };
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Corrections could not be loaded.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const correctionEventId = getNumberField(payload, "correctionEventId");
  const correctionId = getNumberField(payload, "correctionId");
  const decision = getStringField(payload, "decision") as
    | CorrectionDecision
    | null;
  const operation = getStringField(payload, "operation");
  const proposedStatus = getStringField(payload, "proposedStatus");
  const reviewNote = getStringField(payload, "reviewNote");

  if (reviewNote && reviewNote.length > 500) {
    return NextResponse.json(
      { error: "Review note cannot exceed 500 characters." },
      { status: 400 },
    );
  }

  if (operation === "edit") {
    if (!Number.isInteger(correctionId) || correctionId <= 0) {
      return NextResponse.json(
        { error: "A valid correctionId is required." },
        { status: 400 },
      );
    }

    if (!proposedStatus || !allowedCorrectionStatuses.has(proposedStatus)) {
      return NextResponse.json(
        { error: "Proposed status is outside the correction allowlist." },
        { status: 400 },
      );
    }

    return editCorrection(correctionId, proposedStatus, reviewNote);
  }

  if (operation === "execute") {
    if (!Number.isInteger(correctionId) || correctionId <= 0) {
      return NextResponse.json(
        { error: "A valid correctionId is required." },
        { status: 400 },
      );
    }

    return executeCorrection(correctionId);
  }

  if (!Number.isInteger(correctionEventId) || correctionEventId <= 0) {
    return NextResponse.json(
      { error: "A valid correctionEventId is required." },
      { status: 400 },
    );
  }

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "Decision must be approved or rejected." },
      { status: 400 },
    );
  }

  try {
    const telemetryRows = await supabaseRequest<AgentTelemetryRow[]>(
      `/rest/v1/agent_telemetry?select=id,ledger_id,timestamp,hypothesis,falsification_test,confidence_score,step_executed&id=eq.${correctionEventId}&step_executed=in.(${correctionSteps.join(",")})&limit=1`,
    );
    const correction = telemetryRows[0];

    if (!correction || correction.ledger_id === null) {
      return NextResponse.json(
        { error: "The correction candidate or its ledger could not be found." },
        { status: 404 },
      );
    }

    const [proposal] = await loadCorrectionProposals([correction.id]);

    if (proposal) {
      const result = await supabaseRequest<CorrectionRpcResult>(
        "/rest/v1/rpc/review_ledger_correction",
        {
          body: {
            p_correction_id: proposal.id,
            p_decision: decision,
            p_review_note: reviewNote,
            p_reviewed_by: null,
          },
          method: "POST",
        },
      );

      if (!result.ok) {
        return NextResponse.json(
          { error: result.message ?? "Correction decision was blocked." },
          { status: 409 },
        );
      }

      return NextResponse.json({
        decision: {
          correctionId: result.correction_id ?? proposal.id,
          decision: result.review_status ?? decision,
          decisionEventId: result.decision_event_id ?? null,
          decisionRecordedAt: result.reviewed_at ?? new Date().toISOString(),
          eventId: correction.id,
          executionStatus: result.execution_status ?? null,
          reviewNote,
        },
      });
    }

    const isApproved = decision === "approved";
    const eventType = isApproved ? "human_approval" : "human_rejection";
    const noteSuffix = reviewNote ? ` Note: ${reviewNote}` : "";
    const humanPrompt = isApproved
      ? `Correction candidate #${correction.id} approved for constrained execution.`
      : `Correction candidate #${correction.id} rejected by human review.`;
    const agentResponse = isApproved
      ? "Protocol action: correction authorized for a future constrained execution step. No ledger mutation was performed."
      : "Protocol action: correction candidate closed. No ledger mutation was performed.";
    const [decisionEvent] = await supabaseRequest<CorrectionDecisionEvent[]>(
      "/rest/v1/ledger_agent_prompt_events",
      {
        body: [
          {
            agent_response: agentResponse,
            completed_at: new Date().toISOString(),
            event_type: eventType,
            human_prompt: `${humanPrompt}${noteSuffix}`,
            ledger_id: correction.ledger_id,
            status: "completed",
            telemetry_id: correction.id,
          },
        ],
        method: "POST",
        prefer: "return=representation",
      },
    );

    if (!decisionEvent) {
      throw new Error("Correction decision insert returned no row.");
    }

    return NextResponse.json({
      decision: {
        decision,
        decisionEventId: decisionEvent.id,
        decisionRecordedAt: decisionEvent.created_at,
        eventId: correction.id,
        reviewNote,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Correction decision could not be saved.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function editCorrection(
  correctionId: number,
  proposedStatus: string,
  editNote: string | null,
) {
  try {
    const result = await supabaseRequest<CorrectionRpcResult>(
      "/rest/v1/rpc/edit_ledger_correction_proposal",
      {
        body: {
          p_correction_id: correctionId,
          p_edit_note: editNote,
          p_edited_by: null,
          p_proposed_status: proposedStatus,
        },
        method: "POST",
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message ?? "Correction edit was blocked." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      correction: {
        correctionId: result.correction_id ?? correctionId,
        editId: result.edit_id ?? null,
        proposedValue: result.proposed_value ?? proposedStatus,
        reviewNote: result.review_note ?? editNote,
        updatedAt: result.updated_at ?? new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Correction edit could not be saved.",
      },
      { status: 500 },
    );
  }
}

async function executeCorrection(correctionId: number) {
  try {
    const result = await supabaseRequest<CorrectionRpcResult>(
      "/rest/v1/rpc/apply_ledger_correction",
      {
        body: { p_correction_id: correctionId },
        method: "POST",
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message ?? "Correction execution was blocked." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      execution: {
        appliedAt: new Date().toISOString(),
        correctionId: result.correction_id ?? correctionId,
        executionStatus: "applied",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Correction could not be executed.",
      },
      { status: 500 },
    );
  }
}

async function loadCorrectionProposals(telemetryIds: number[]) {
  if (telemetryIds.length === 0) {
    return [];
  }

  try {
    return await supabaseRequest<CorrectionProposalRow[]>(
      `/rest/v1/ledger_correction_proposals?select=id,telemetry_id,target_column,before_value,proposed_value,evidence,rationale,review_status,execution_status,review_note,reviewed_at,applied_at,execution_error,created_at,updated_at&telemetry_id=in.(${telemetryIds.join(",")})`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("ledger_correction_proposals") ||
        error.message.includes("PGRST205"))
    ) {
      return [];
    }

    throw error;
  }
}

async function loadCorrectionEdits(correctionIds: number[]) {
  if (correctionIds.length === 0) {
    return [];
  }

  try {
    return await supabaseRequest<CorrectionEditRow[]>(
      `/rest/v1/ledger_correction_proposal_edits?select=id,correction_id,before_proposed_value,after_proposed_value,edit_note,created_at&correction_id=in.(${correctionIds.join(",")})&order=created_at.asc`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("ledger_correction_proposal_edits") ||
        error.message.includes("PGRST205"))
    ) {
      return [];
    }

    throw error;
  }
}

function decisionFromEventType(
  eventType: CorrectionDecisionEvent["event_type"],
): CorrectionDecision {
  return eventType === "human_approval" ? "approved" : "rejected";
}

function decisionFromReviewStatus(
  reviewStatus: CorrectionProposalRow["review_status"] | undefined,
): CorrectionDecision | null {
  return reviewStatus === "approved" || reviewStatus === "rejected"
    ? reviewStatus
    : null;
}

function getNumberField(payload: unknown, key: string) {
  if (!isObject(payload)) {
    return Number.NaN;
  }

  const value = payload[key];
  return typeof value === "number" ? value : Number(value);
}

function getStringField(payload: unknown, key: string) {
  if (!isObject(payload)) {
    return null;
  }

  const value = payload[key];
  return typeof value === "string" ? value.trim() : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeConfidence(value: string | number | null) {
  const confidence = Number(value ?? 0);

  if (Number.isNaN(confidence)) {
    return 0;
  }

  return Math.min(Math.max(confidence, 0), 1);
}
