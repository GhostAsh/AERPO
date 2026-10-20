"""Deterministic orchestration loop for ERP ledger optimization."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from backend.nebius_client import NebiusClient
from backend.schemas import (
    HumanReviewDecision,
    LedgerRecord,
    OptimizationRequest,
    OptimizationResponse,
)


SYSTEM_PROMPT = """You are a constrained ERP optimization inference engine.
Return exactly one valid compact JSON object.
Do not return markdown, prose, explanations, code fences, or chat text.
Use only the keys provided in the response_contract.
Keep every string under 140 characters.
Return hypothesis_generation as an array with exactly one object.
Return falsification_testing as an array with exactly one object.
Every proposed correction must include required evidence.
Never claim that a ledger mutation is approved; humans approve final changes.
Only propose database field_updates allowed by permitted_database_actions.
Treat every other table or column as read-only.
When human_decision is provided, follow human_decision_protocol exactly."""


ALLOWED_LEDGER_STATUS_VALUES = {"pending", "review", "approved", "duplicate"}


def format_protocol_violation(exc: ValidationError) -> str:
    """Converts model schema drift into an operator-facing protocol message."""

    reasons: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        error_type = error.get("type")

        if error_type == "missing" and location:
            reasons.append(f"MISSING_COLUMN_{location.upper()}")
            continue

        if location and error_type:
            reasons.append(f"{error_type.upper()}_{location.upper()}")
            continue

        if error_type:
            reasons.append(error_type.upper())

    reason = "_AND_".join(reasons) if reasons else "UNKNOWN_SCHEMA_VIOLATION"

    return format_agent_protocol_violation(reason)


def format_agent_protocol_violation(reason: str) -> str:
    """Formats operator-facing agent protocol failures consistently."""

    return (
        "Agent abligation protocol: agent failed to follow "
        f"'PROTOCOL IS VIOLATED' by '{reason}'"
    )


def summarize_validation_errors(exc: ValidationError) -> str:
    """Builds a compact correction hint from Pydantic validation errors."""

    hints: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        error_type = str(error.get("type", "schema_error"))
        if location:
            hints.append(f"{location}: {error_type}")
        else:
            hints.append(error_type)
    return "; ".join(hints)


def build_retry_messages(
    request: OptimizationRequest,
    validation_error: ValidationError,
) -> list[dict[str, str]]:
    """Builds a corrective retry prompt after the model violates the schema."""

    correction = {
        "protocol_violation": summarize_validation_errors(validation_error),
        "required_fix": (
            "Return the same response_contract shape. "
            "hypothesis_generation and falsification_testing must be arrays."
        ),
        "response_contract": request.response_contract,
    }

    return [
        *build_messages(request),
        {
            "role": "user",
            "content": json.dumps(correction, sort_keys=True),
        },
    ]


def build_protocol_retry_messages(
    request: OptimizationRequest,
    protocol_error: ValueError,
) -> list[dict[str, str]]:
    """Builds one corrective retry after a semantic protocol violation."""

    correction = {
        "protocol_violation": str(protocol_error),
        "required_fix": (
            "Return a compliant response for this exact ledger. Use the "
            "required_ledger_id and only permitted_database_actions."
        ),
        "required_ledger_id": request.ledger_record.id,
        "response_contract": request.response_contract,
    }

    return [
        *build_messages(request),
        {
            "role": "user",
            "content": json.dumps(correction, sort_keys=True),
        },
    ]


def validate_permitted_database_action(
    response: OptimizationResponse,
    ledger_record: LedgerRecord,
) -> OptimizationResponse:
    """Allows only explicit ledger status updates through the agent contract."""

    proposed_action = response.proposed_action
    if proposed_action.ledger_id != ledger_record.id:
        raise ValueError(format_agent_protocol_violation("LEDGER_ID_MISMATCH"))

    for column, value in proposed_action.field_updates.items():
        if column != "status":
            raise ValueError(
                format_agent_protocol_violation(
                    f"READ_ONLY_COLUMN_ERP_LEDGER.{column.upper()}"
                )
            )

        if value not in ALLOWED_LEDGER_STATUS_VALUES:
            raise ValueError(
                format_agent_protocol_violation(
                    f"DISALLOWED_VALUE_ERP_LEDGER.{column.upper()}"
                )
            )

    if proposed_action.action == "create_correction_candidate":
        proposed_status = proposed_action.field_updates.get("status")
        if not isinstance(proposed_status, str):
            raise ValueError(
                format_agent_protocol_violation(
                    "CORRECTION_CANDIDATE_REQUIRES_STATUS_UPDATE"
                )
            )

        if proposed_status == ledger_record.status:
            raise ValueError(
                format_agent_protocol_violation(
                    "CORRECTION_CANDIDATE_REQUIRES_CHANGED_STATUS"
                )
            )

    return response


def validate_human_decision_protocol(
    response: OptimizationResponse,
    human_decision: HumanReviewDecision | None,
) -> OptimizationResponse:
    """Constrains agent follow-up behavior after a human review action."""

    if human_decision is None:
        return response

    proposed_action = response.proposed_action
    next_status = proposed_action.field_updates.get("status")

    if human_decision.action == "approved":
        if next_status is not None and next_status != "approved":
            raise ValueError(
                format_agent_protocol_violation(
                    "HUMAN_APPROVED_REQUIRES_APPROVED_STATUS"
                )
            )
        return response

    if human_decision.action == "evidence":
        if next_status in {"approved", "duplicate"}:
            raise ValueError(
                format_agent_protocol_violation(
                    "HUMAN_EVIDENCE_REQUEST_CANNOT_FINALIZE_OR_DROP"
                )
            )
        if not response.required_evidence:
            raise ValueError(
                format_agent_protocol_violation(
                    "HUMAN_EVIDENCE_REQUEST_REQUIRES_EVIDENCE"
                )
            )
        return response

    if human_decision.action == "rejected":
        if next_status is not None and next_status != "duplicate":
            raise ValueError(
                format_agent_protocol_violation(
                    "HUMAN_REJECTED_REQUIRES_DUPLICATE_STATUS"
                )
            )
        return response

    return response


def build_messages(request: OptimizationRequest) -> list[dict[str, str]]:
    """Builds the strict OpenAI-compatible chat payload for Nebius."""

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": json.dumps(request.model_dump(mode="json"), sort_keys=True),
        },
    ]


def optimize_ledger_record(
    ledger_payload: dict[str, Any],
    *,
    client: NebiusClient | None = None,
    human_decision: HumanReviewDecision | None = None,
) -> OptimizationResponse:
    """Runs one ledger row through the model and validates the JSON contract."""

    ledger_record = LedgerRecord.model_validate(ledger_payload)
    request = OptimizationRequest(
        ledger_record=ledger_record,
        human_decision=human_decision,
    )
    nebius_client = client or NebiusClient()

    messages = build_messages(request)

    for attempt in range(2):
        raw_response = nebius_client.complete_json(
            messages,
            max_tokens=2000,
        )

        try:
            response = OptimizationResponse.model_validate(raw_response)
        except ValidationError as exc:
            if attempt == 1:
                raise ValueError(format_protocol_violation(exc)) from exc
            messages = build_retry_messages(request, exc)
            continue

        try:
            validate_permitted_database_action(response, ledger_record)
            return validate_human_decision_protocol(response, human_decision)
        except ValueError as exc:
            if attempt == 1:
                raise
            messages = build_protocol_retry_messages(request, exc)

    raise ValueError(format_agent_protocol_violation("RETRY_EXHAUSTED"))
