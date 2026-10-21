import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseServerRequest } from "@/lib/supabase/server";

type LedgerInsert = {
  amount: number;
  department: string;
  description: string;
  optimization_notes: string | null;
  status: "pending";
  transaction_date: string;
};

type LedgerRow = LedgerInsert & {
  id: number;
};

type LedgerCreationResult = {
  code: string;
  ledger?: LedgerRow;
  message?: string;
  ok: boolean;
  replayed?: boolean;
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const runtime = "nodejs";

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

  const validation = validateLedgerInput(payload);

  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";

  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return NextResponse.json(
      { error: "A valid idempotency key is required to create a ledger." },
      { status: 400 },
    );
  }

  try {
    const result = await createLedgerIdempotently(
      idempotencyKey,
      validation.ledger,
    );

    if (!result.ok || !result.ledger) {
      return NextResponse.json(
        { error: result.message ?? "Ledger creation was blocked." },
        { status: result.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400 },
      );
    }

    return NextResponse.json(
      { ledger: result.ledger, replayed: result.replayed ?? false },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Ledger could not be created.",
      },
      { status: 500 },
    );
  }
}

function validateLedgerInput(payload: unknown):
  | { ledger: LedgerInsert }
  | { error: string } {
  if (!isObject(payload)) {
    return { error: "Ledger details are required." };
  }

  const description = stringField(payload, "description");
  const department = stringField(payload, "department");
  const transactionDate = stringField(payload, "transactionDate");
  const optimizationNotes = stringField(payload, "optimizationNotes");
  const amount = Number(payload.amount);

  if (!description || description.length > 240) {
    return { error: "Description must be between 1 and 240 characters." };
  }
  if (!department || department.length > 80) {
    return { error: "Department must be between 1 and 80 characters." };
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: "Amount must be a non-zero number." };
  }
  if (!isIsoDate(transactionDate)) {
    return { error: "Transaction date must be a valid date." };
  }
  if (optimizationNotes && optimizationNotes.length > 500) {
    return { error: "Review context cannot exceed 500 characters." };
  }

  return {
    ledger: {
      amount,
      department,
      description,
      optimization_notes: optimizationNotes || null,
      status: "pending",
      transaction_date: transactionDate,
    },
  };
}

async function createLedgerIdempotently(
  idempotencyKey: string,
  ledger: LedgerInsert,
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(ledger))
    .digest("hex");
  const result = await supabaseServerRequest<LedgerCreationResult>(
    "/rest/v1/rpc/create_ledger_idempotently",
    {
      body: {
        p_amount: ledger.amount,
        p_department: ledger.department,
        p_description: ledger.description,
        p_idempotency_key: idempotencyKey,
        p_optimization_notes: ledger.optimization_notes,
        p_request_hash: requestHash,
        p_transaction_date: ledger.transaction_date,
      },
      method: "POST",
    },
  );

  if (!isObject(result) || typeof result.ok !== "boolean") {
    throw new Error("Ledger creation function returned an invalid response.");
  }

  return result;
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
