"""Runs one model optimization and logs the result to Supabase telemetry."""

from __future__ import annotations

from backend.orchestration import optimize_ledger_record
from backend.supabase_client import SupabaseClient


SAMPLE_LEDGER_RECORD = {
    "id": 0,
    "transaction_date": "2026-10-08",
    "description": "Vendor invoice variance for freight allocation",
    "amount": "18420.00",
    "department": "Operations",
    "status": "review",
    "optimization_notes": "Possible duplicate freight allocation.",
}


def main() -> None:
    """Calls Nebius once, validates the response, and records telemetry."""

    result = optimize_ledger_record(SAMPLE_LEDGER_RECORD)
    first_hypothesis = result.hypothesis_generation[0]
    first_test = result.falsification_testing[0]

    telemetry_row = {
        "ledger_id": None,
        "hypothesis": first_hypothesis.claim,
        "falsification_test": first_test.test,
        "confidence_score": result.confidence_score,
        "step_executed": result.proposed_action.action,
    }

    inserted = SupabaseClient().insert_agent_telemetry(telemetry_row)

    print("model_action=", result.proposed_action.action)
    print("confidence_score=", result.confidence_score)
    print("telemetry_id=", inserted["id"])


if __name__ == "__main__":
    main()
