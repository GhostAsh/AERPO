import { NextRequest, NextResponse } from "next/server";
import {
  hasMeaningfulEvidenceNames,
  isMeaningfulTelemetryNarrative,
  telemetryCorrectionInstruction,
} from "@/lib/agent-telemetry-quality";
import { supabaseServerRequest as supabaseRequest } from "@/lib/supabase/server";

type HumanAction = "approved" | "evidence" | "rejected";

type HumanActionEvent = {
  completed_at?: string | null;
  created_at: string;
  event_type: string;
  human_prompt: string | null;
  id: number;
  ledger_id: number;
  status?: string;
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

type LedgerUpdate = {
  id: number;
  status: string | null;
};

type CorrectionLockRow = {
  execution_status: string;
  ledger_id: number;
  review_status: string;
};

type AgentEvidenceResponse = {
  answer: string;
  confidence_score: number;
  evidence_needed: string[];
  falsification_test: string;
  hypothesis: string;
  protocol_action: string;
};

class ProtocolViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolViolationError";
  }
}

const actionProtocol: Record<
  HumanAction,
  {
    eventType: "evidence_request" | "human_approval" | "human_rejection";
    ledgerStatus: "approved" | "duplicate" | "review";
    note: string;
  }
> = {
  approved: {
    eventType: "human_approval",
    ledgerStatus: "approved",
    note: "Human approved the ledger; protocol permits final approved status.",
  },
  evidence: {
    eventType: "evidence_request",
    ledgerStatus: "review",
    note: "Human requested more evidence; protocol keeps the ledger in review.",
  },
  rejected: {
    eventType: "human_rejection",
    ledgerStatus: "duplicate",
    note: "Human rejected the ledger; protocol marks it as a duplicate candidate.",
  },
};

export const runtime = "nodejs";

export async function GET() {
  try {
    const [events, correctionLocks] = await Promise.all([
      supabaseRequest<HumanActionEvent[]>(
        "/rest/v1/ledger_agent_prompt_events?select=id,ledger_id,event_type,human_prompt,status,created_at,completed_at&event_type=in.(human_approval,human_rejection,evidence_request)&order=created_at.desc&limit=500",
      ),
      loadActiveCorrectionLocks(),
    ]);
    const latestByLedger = new Map<number, HumanActionEvent>();

    for (const event of events) {
      if (event.human_prompt?.startsWith("Correction candidate #")) {
        continue;
      }

      if (!latestByLedger.has(event.ledger_id)) {
        latestByLedger.set(event.ledger_id, event);
      }
    }

    const latestEvents = Array.from(latestByLedger.values());
    const ledgerIds = latestEvents.map((event) => event.ledger_id);
    const ledgers =
      ledgerIds.length > 0
        ? await supabaseRequest<LedgerRow[]>(
            `/rest/v1/erp_ledger?select=id,transaction_date,description,amount,department,status,optimization_notes&id=in.(${ledgerIds.join(",")})`,
          )
        : [];
    const ledgerById = new Map(ledgers.map((ledger) => [ledger.id, ledger]));

    return NextResponse.json({
      correctionLockedLedgerIds: Array.from(
        new Set(correctionLocks.map((correction) => correction.ledger_id)),
      ),
      decisions: latestEvents.map((event) => ({
        action: actionFromEventType(event.event_type),
        completedAt: event.completed_at ?? null,
        eventId: event.id,
        eventStatus: event.status ?? "completed",
        ledger: ledgerById.get(event.ledger_id) ?? null,
        ledgerId: event.ledger_id,
        note: event.human_prompt ?? "Human action recorded.",
        recordedAt: event.created_at,
      })),
    });
  } catch (error) {
    return humanActionErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const ledgerId = getNumberField(payload, "ledgerId");
  const action = getStringField(payload, "action") as HumanAction | null;

  if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
    return NextResponse.json(
      { error: "A valid ledgerId is required." },
      { status: 400 },
    );
  }

  if (!action || !(action in actionProtocol)) {
    return NextResponse.json(
      { error: "A supported human action is required." },
      { status: 400 },
    );
  }

  const protocol = actionProtocol[action];

  try {
    const [ledger, correctionLocks] = await Promise.all([
      getLedgerRow(ledgerId),
      loadActiveCorrectionLocks(ledgerId),
    ]);

    if (ledger.status !== "pending" && ledger.status !== "review") {
      return NextResponse.json(
        { error: "Finalized ledgers cannot receive another human decision." },
        { status: 409 },
      );
    }

    if (correctionLocks.length > 0) {
      return NextResponse.json(
        {
          error:
            "This ledger already has an approved correction awaiting constrained execution.",
        },
        { status: 409 },
      );
    }

    const [queuedEvent] = await supabaseRequest<HumanActionEvent[]>(
      "/rest/v1/ledger_agent_prompt_events",
      {
        body: [
          {
            event_type: protocol.eventType,
            human_prompt: protocol.note,
            ledger_id: ledgerId,
            status: "queued",
          },
        ],
        method: "POST",
        prefer: "return=representation",
      },
    );

    if (!queuedEvent) {
      throw new Error("Human action event insert returned no row.");
    }

    const [updatedLedger] = await supabaseRequest<LedgerUpdate[]>(
      `/rest/v1/erp_ledger?id=eq.${ledgerId}`,
      {
        body: { status: protocol.ledgerStatus },
        method: "PATCH",
        prefer: "return=representation",
      },
    );

    if (!updatedLedger) {
      throw new Error("Ledger status update returned no row.");
    }

    const event =
      action === "evidence"
        ? await completeEvidenceRequestEvent(queuedEvent.id, ledgerId)
        : await completeHumanDecisionEvent(queuedEvent.id);

    return NextResponse.json({
      decision: {
        action,
        ledgerId,
        note: protocol.note,
      },
      event,
      ledger: updatedLedger,
    });
  } catch (error) {
    return humanActionErrorResponse(error);
  }
}

async function completeHumanDecisionEvent(eventId: number) {
  const [event] = await updateHumanActionEvent(eventId, {
    completed_at: new Date().toISOString(),
    status: "completed",
  });

  return event;
}

async function completeEvidenceRequestEvent(eventId: number, ledgerId: number) {
  await updateHumanActionEvent(eventId, { status: "thinking" });

  try {
    const ledger = await getLedgerRow(ledgerId);
    const agentResponse = await runConstrainedEvidencePrompt(ledger);
    const [telemetryEvent] = await insertAgentTelemetry({
      confidence_score: agentResponse.confidence_score,
      falsification_test: agentResponse.falsification_test,
      hypothesis: agentResponse.hypothesis,
      ledger_id: ledger.id,
      step_executed: "gather_evidence",
    });
    const [event] = await updateHumanActionEvent(eventId, {
      agent_response: formatAgentEvidenceResponse(agentResponse),
      completed_at: new Date().toISOString(),
      status: "completed",
      telemetry_id: telemetryEvent?.id ?? null,
    });

    return event;
  } catch (error) {
    const isProtocolViolation = error instanceof ProtocolViolationError;
    const [event] = await updateHumanActionEvent(eventId, {
      completed_at: new Date().toISOString(),
      error_message:
        error instanceof Error ? error.message : "Evidence request failed.",
      status: isProtocolViolation ? "protocol_blocked" : "failed",
    });

    return event;
  }
}

async function getLedgerRow(ledgerId: number) {
  const rows = await supabaseRequest<LedgerRow[]>(
    `/rest/v1/erp_ledger?select=id,transaction_date,description,amount,department,status,optimization_notes&id=eq.${ledgerId}&limit=1`,
  );
  const ledger = rows[0];

  if (!ledger) {
    throw new Error(`Ledger #${ledgerId} was not found.`);
  }

  return ledger;
}

async function loadActiveCorrectionLocks(ledgerId?: number) {
  const ledgerFilter = ledgerId === undefined ? "" : `&ledger_id=eq.${ledgerId}`;

  return supabaseRequest<CorrectionLockRow[]>(
    "/rest/v1/ledger_correction_proposals" +
      "?select=ledger_id,review_status,execution_status" +
      "&review_status=eq.approved" +
      "&execution_status=in.(ready,applying,failed)" +
      ledgerFilter,
  );
}

async function updateHumanActionEvent(
  eventId: number,
  payload: Record<string, unknown>,
) {
  return supabaseRequest<HumanActionEvent[]>(
    `/rest/v1/ledger_agent_prompt_events?id=eq.${eventId}`,
    {
      body: payload,
      method: "PATCH",
      prefer: "return=representation",
    },
  );
}

async function insertAgentTelemetry(payload: {
  confidence_score: number;
  falsification_test: string;
  hypothesis: string;
  ledger_id: number;
  step_executed: string;
}) {
  return supabaseRequest<{ id: number }[]>("/rest/v1/agent_telemetry", {
    body: [payload],
    method: "POST",
    prefer: "return=representation",
  });
}

async function runConstrainedEvidencePrompt(ledger: LedgerRow) {
  let messages = [
    {
      role: "system",
      content: [
        "You are a constrained ERP ledger evidence agent.",
        "Return exactly one compact JSON object and no markdown.",
        "A human requested more evidence before approving this ledger.",
        "Use only the provided ledger record.",
        "You may not propose or perform database writes.",
        "Treat every table and column as read-only for this evidence event.",
        "If evidence is missing, say Unknown or conditional in answer and list needed evidence.",
        "Ground hypothesis in concrete ledger fields or values.",
        "Falsification test must state a specific check that could disprove the hypothesis.",
        "Angle-bracket contract values are instructions and must never be copied.",
        "Always set protocol_action to gather_evidence or request_evidence.",
        "Keep every string under 180 characters.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          event_type: "evidence_request",
          human_prompt:
            "Gather available evidence for this ledger and identify what is still missing.",
          ledger_record: ledger,
          protocol: {
            authority: "The protocol owns authorization. The agent only gathers evidence.",
            disallowed_actions: [
              "database_update",
              "database_delete",
              "schema_change",
              "status_mutation",
            ],
            response_contract: {
              answer: "<evidence summary grounded in available ledger context>",
              confidence_score: 0.0,
              evidence_needed: ["<specific ledger field or missing document>"],
              falsification_test: "<specific check that could disprove the concern>",
              hypothesis: "<ledger-specific evidence conclusion using provided values>",
              protocol_action: "gather_evidence",
            },
          },
        },
        null,
        0,
      ),
    },
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rawResponse = await completePromptJson(messages);

    try {
      return validateAgentEvidenceResponse(rawResponse);
    } catch (error) {
      if (!(error instanceof ProtocolViolationError) || attempt === 1) {
        throw error;
      }

      messages = [
        ...messages,
        { role: "user", content: telemetryCorrectionInstruction },
      ];
    }
  }

  throw new ProtocolViolationError("TELEMETRY_QUALITY_RETRY_EXHAUSTED");
}

async function completePromptJson(messages: { content: string; role: string }[]) {
  const apiKey = process.env.NEBIUS_API_KEY;
  const baseUrl = (
    process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.NEBIUS_MODEL ?? "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF";

  if (!apiKey) {
    throw new Error("NEBIUS_API_KEY is not configured.");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    body: JSON.stringify({
      max_tokens: 900,
      messages,
      model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const responseText = await response.text();
  const data = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    const details =
      typeof data === "object" && data && "error" in data
        ? JSON.stringify(data.error)
        : responseText;
    throw new Error(`Nebius API error ${response.status}: ${details}`);
  }

  const content = getModelContent(data);

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ProtocolViolationError("MODEL_RETURNED_NON_JSON_EVIDENCE_RESPONSE");
  }
}

function validateAgentEvidenceResponse(rawResponse: unknown): AgentEvidenceResponse {
  if (!isObject(rawResponse)) {
    throw new ProtocolViolationError("EVIDENCE_RESPONSE_NOT_OBJECT");
  }

  const answer = rawResponse.answer;
  const confidenceScore = rawResponse.confidence_score;
  const evidenceNeeded = rawResponse.evidence_needed;
  const falsificationTest = rawResponse.falsification_test;
  const hypothesis = rawResponse.hypothesis;
  const protocolAction = rawResponse.protocol_action;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new ProtocolViolationError("MISSING_ANSWER");
  }

  if (
    typeof confidenceScore !== "number" ||
    confidenceScore < 0 ||
    confidenceScore > 1
  ) {
    throw new ProtocolViolationError("INVALID_CONFIDENCE_SCORE");
  }

  if (
    !hasMeaningfulEvidenceNames(evidenceNeeded)
  ) {
    throw new ProtocolViolationError("INVALID_EVIDENCE_NEEDED");
  }

  if (!isMeaningfulTelemetryNarrative(falsificationTest)) {
    throw new ProtocolViolationError("INVALID_FALSIFICATION_TEST_CONTENT");
  }

  if (!isMeaningfulTelemetryNarrative(hypothesis)) {
    throw new ProtocolViolationError("INVALID_HYPOTHESIS_CONTENT");
  }

  if (
    protocolAction !== "gather_evidence" &&
    protocolAction !== "request_evidence"
  ) {
    throw new ProtocolViolationError("INVALID_PROTOCOL_ACTION");
  }

  return {
    answer,
    confidence_score: confidenceScore,
    evidence_needed: evidenceNeeded,
    falsification_test: falsificationTest,
    hypothesis,
    protocol_action: protocolAction,
  };
}

function formatAgentEvidenceResponse(response: AgentEvidenceResponse) {
  const evidence =
    response.evidence_needed.length > 0
      ? response.evidence_needed.join(", ")
      : "None identified from current ledger context.";

  return [
    `Answer: ${response.answer}`,
    `Evidence needed: ${evidence}`,
    `Protocol action: ${response.protocol_action}`,
  ].join("\n");
}

function getModelContent(data: unknown) {
  if (!isObject(data) || !Array.isArray(data.choices)) {
    throw new ProtocolViolationError("MODEL_RESPONSE_MISSING_CHOICES");
  }

  const firstChoice = data.choices[0];

  if (!isObject(firstChoice) || !isObject(firstChoice.message)) {
    throw new ProtocolViolationError("MODEL_RESPONSE_MISSING_MESSAGE");
  }

  const content = firstChoice.message.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new ProtocolViolationError("MODEL_RESPONSE_MISSING_CONTENT");
  }

  return content;
}

function actionFromEventType(eventType: string): HumanAction {
  if (eventType === "human_approval") {
    return "approved";
  }

  if (eventType === "human_rejection") {
    return "rejected";
  }

  return "evidence";
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

function humanActionErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Human action request failed.";

  return NextResponse.json({ error: message }, { status: 500 });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
