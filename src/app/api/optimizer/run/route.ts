import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as {
    ledgerId?: unknown;
  };
  const ledgerId =
    payload.ledgerId === undefined ? null : Number(payload.ledgerId);

  if (
    ledgerId !== null &&
    (!Number.isInteger(ledgerId) || ledgerId <= 0)
  ) {
    return NextResponse.json(
      { error: "ledgerId must be a positive integer." },
      { status: 400 },
    );
  }

  try {
    const args = ["-m", "backend.run_optimizer_batch"];

    if (ledgerId !== null) {
      args.push("--ledger-id", ledgerId.toString());
    }

    const { stdout } = await execFileAsync(
      "python",
      args,
      {
        cwd: process.cwd(),
        timeout: 120_000,
      },
    );

    const result = JSON.parse(stdout.trim()) as {
      inspected: number;
      status_update_skipped: number;
      status_updates: { ledger_id: number; status: string }[];
      telemetry_ids: number[];
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Optimizer failed.";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
