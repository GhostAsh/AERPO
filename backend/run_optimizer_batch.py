"""Runs the optimizer against pending ledger rows and records telemetry."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from backend.nebius_client import NebiusClientError
from backend.orchestration import optimize_ledger_record
from backend.supabase_client import SupabaseClient, SupabaseClientError


INSPECTABLE_STATUSES = {"pending", "review"}


def run_optimizer_batch(
    supabase: SupabaseClient,
    *,
    ledger_id: int | None = None,
) -> dict[str, Any]:
    """Inspects non-approved ledger rows, writes telemetry, and applies status."""

    if ledger_id is None:
        ledger_rows = supabase.list_erp_ledger(limit=25)
    else:
        ledger_row = supabase.get_erp_ledger(ledger_id)
        ledger_rows = [ledger_row] if ledger_row else []

    candidates = [
        row
        for row in ledger_rows
        if (row.get("status") or "pending") in INSPECTABLE_STATUSES
    ][:3]

    inserted_rows: list[dict[str, Any]] = []
    correction_rows: list[dict[str, Any]] = []
    existing_correction_rows: list[dict[str, Any]] = []
    status_updates: list[dict[str, Any]] = []
    status_update_skipped = 0

    for ledger_row in candidates:
        document_evidence = supabase.list_ledger_document_evidence(ledger_row["id"])
        result = optimize_ledger_record(
            ledger_row,
            document_evidence=document_evidence,
        )
        first_hypothesis = result.hypothesis_generation[0]
        first_test = result.falsification_testing[0]

        inserted = supabase.insert_agent_telemetry(
            {
                "ledger_id": ledger_row["id"],
                "hypothesis": first_hypothesis.claim,
                "falsification_test": first_test.test,
                "confidence_score": result.confidence_score,
                "step_executed": result.proposed_action.action,
            }
        )
        inserted_rows.append(inserted)

        next_status = result.proposed_action.field_updates.get("status")
        if (
            result.proposed_action.action == "create_correction_candidate"
            and isinstance(next_status, str)
        ):
            if next_status == ledger_row.get("status"):
                status_update_skipped += 1
                continue

            correction, created = supabase.queue_ledger_correction_proposal(
                {
                    "ledger_id": ledger_row["id"],
                    "telemetry_id": inserted["id"],
                    "target_table": "erp_ledger",
                    "target_column": "status",
                    "before_value": ledger_row.get("status"),
                    "proposed_value": next_status,
                    "evidence": result.required_evidence,
                    "rationale": result.proposed_action.rationale,
                    "confidence_score": result.confidence_score,
                }
            )
            if created:
                correction_rows.append(correction)
            else:
                existing_correction_rows.append(correction)
            status_update_skipped += 1
        elif isinstance(next_status, str):
            updated = supabase.update_erp_ledger_status(ledger_row["id"], next_status)
            status_updates.append(
                {
                    "ledger_id": updated["id"],
                    "status": updated.get("status", next_status),
                }
            )
        else:
            status_update_skipped += 1

    return {
        "inspected": len(candidates),
        "correction_ids": [row["id"] for row in correction_rows],
        "existing_correction_ids": [
            row["id"] for row in existing_correction_rows
        ],
        "telemetry_ids": [row["id"] for row in inserted_rows],
        "status_updates": status_updates,
        "status_update_skipped": status_update_skipped,
    }


def main() -> None:
    """Runs the optimizer batch and prints a machine-readable summary."""

    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger-id", type=int)
    args = parser.parse_args()

    print(
        json.dumps(
            run_optimizer_batch(SupabaseClient(), ledger_id=args.ledger_id),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (NebiusClientError, SupabaseClientError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
