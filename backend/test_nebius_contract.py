"""Tests for the Nebius model contract without calling the live API."""

import json

import pytest

from backend.nebius_client import (
    NebiusClient,
    NebiusClientError,
    NebiusResponseError,
    NebiusSettings,
)

from backend.orchestration import build_messages, optimize_ledger_record
from backend.schemas import (
    HumanReviewDecision,
    LedgerRecord,
    OptimizationRequest,
    OptimizationResponse,
)


class MissingConfidenceClient:
    """Fake client that returns schema-drifting model output."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "Ledger may need review.",
                    "evidence_fields": ["description"],
                    "expected_impact": "Confirm evidence before action.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Check source evidence.",
                    "required_fields": ["description"],
                    "failure_condition": "Evidence confirms no issue.",
                }
            ],
            "state_weights": {"risk_name": 0.0},
            "required_evidence": ["description"],
            "proposed_action": {
                "action": "request_human_review",
                "ledger_id": 1042,
                "field_updates": {},
                "rationale": "Missing confidence should be rejected.",
            },
        }


class StatusUpdateClient:
    """Fake client that proposes an allowed ledger status update."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "Ledger should move to review.",
                    "evidence_fields": ["status"],
                    "expected_impact": "Route row to human review.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Confirm source evidence is incomplete.",
                    "required_fields": ["optimization_notes"],
                    "failure_condition": "Evidence is complete and policy-safe.",
                }
            ],
            "state_weights": {"review_risk": 0.7},
            "required_evidence": ["optimization_notes"],
            "proposed_action": {
                "action": "request_human_review",
                "ledger_id": 1042,
                "field_updates": {"status": "review"},
                "rationale": "Human review is required before mutation.",
            },
            "confidence_score": 0.81,
        }


@pytest.mark.parametrize(
    ("content", "finish_reason", "retry_budget"),
    [('{"hypothesis_generation": [', "length", 4000),
     ("not JSON", "stop", 2000),
     ("[]", "stop", 2000)],
)
def test_optimizer_retries_invalid_json(
    monkeypatch, content, finish_reason, retry_budget
) -> None:
    client = NebiusClient(NebiusSettings(api_key="test-only"))
    calls = []

    def fake_post(_path, payload):
        calls.append(payload)
        return {"choices": [{
            "finish_reason": finish_reason if len(calls) == 1 else "stop",
            "message": {"content": content if len(calls) == 1 else json.dumps(
                StatusUpdateClient().complete_json()
            )},
        }]}

    monkeypatch.setattr(client, "_post", fake_post)
    response = optimize_ledger_record(
        {"id": 1042, "description": "Vendor invoice variance",
         "amount": "18420.00", "department": "Operations", "status": "pending"},
        client=client,
    )

    assert response.proposed_action.ledger_id == 1042
    assert len(calls) == 2
    assert calls[0]["max_tokens"] == 2000
    assert calls[1]["max_tokens"] == retry_budget
    assert calls[1]["messages"][:2] == calls[0]["messages"]
    assert "INVALID_OR_INCOMPLETE_JSON" in calls[1]["messages"][-1]["content"]


@pytest.mark.parametrize("failure", [
    NebiusResponseError("Invalid JSON", finish_reason="length"),
    NebiusClientError("Nebius API error 401"),
])
def test_optimizer_bounds_json_retries_and_does_not_retry_api_errors(failure) -> None:
    class FailingClient:
        calls = 0

        def complete_json(self, *_args, **_kwargs):
            self.calls += 1
            raise failure

    client = FailingClient()
    with pytest.raises(type(failure), match=str(failure)):
        optimize_ledger_record(
            {"id": 1042, "description": "Vendor invoice variance",
             "amount": "18420.00", "department": "Operations", "status": "pending"},
            client=client,
        )
    assert client.calls == (2 if isinstance(failure, NebiusResponseError) else 1)


class ReadOnlyColumnClient:
    """Fake client that tries to change a read-only ledger field."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "Ledger amount should be changed.",
                    "evidence_fields": ["amount"],
                    "expected_impact": "Would mutate a financial value.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Compare invoice source amount.",
                    "required_fields": ["amount"],
                    "failure_condition": "Source amount matches ledger.",
                }
            ],
            "state_weights": {"amount_risk": 0.5},
            "required_evidence": ["amount"],
            "proposed_action": {
                "action": "create_correction_candidate",
                "ledger_id": 1042,
                "field_updates": {"amount": "0.00"},
                "rationale": "Attempting to change a read-only column.",
            },
            "confidence_score": 0.66,
        }


class HumanApprovedClient:
    """Fake client that finalizes an approved ledger."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "Human approval allows finalization.",
                    "evidence_fields": ["status"],
                    "expected_impact": "Ledger can leave review.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Confirm approval action exists.",
                    "required_fields": ["human_decision"],
                    "failure_condition": "No human approval found.",
                }
            ],
            "state_weights": {"approval_ready": 1.0},
            "required_evidence": ["human_decision"],
            "proposed_action": {
                "action": "finalize_ledger",
                "ledger_id": 1042,
                "field_updates": {"status": "approved"},
                "rationale": "Human approved the ledger.",
            },
            "confidence_score": 0.92,
        }


class HumanEvidenceClient:
    """Fake client that keeps review open while requesting evidence."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "More invoice evidence is required.",
                    "evidence_fields": ["invoice_id"],
                    "expected_impact": "Keep ledger in review.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Fetch matching invoice source.",
                    "required_fields": ["invoice_id"],
                    "failure_condition": "Source invoice cannot be found.",
                }
            ],
            "state_weights": {"evidence_gap": 0.84},
            "required_evidence": ["invoice_id", "vendor_name"],
            "proposed_action": {
                "action": "gather_evidence",
                "ledger_id": 1042,
                "field_updates": {"status": "review"},
                "rationale": "Human requested additional evidence.",
            },
            "confidence_score": 0.79,
        }


class HumanRejectedClient:
    """Fake client that marks a rejected ledger as duplicate."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "Human rejection indicates duplicate treatment.",
                    "evidence_fields": ["human_decision"],
                    "expected_impact": "Remove from active review.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Confirm rejection action exists.",
                    "required_fields": ["human_decision"],
                    "failure_condition": "No rejection found.",
                }
            ],
            "state_weights": {"duplicate_review": 0.9},
            "required_evidence": ["human_decision"],
            "proposed_action": {
                "action": "mark_duplicate",
                "ledger_id": 1042,
                "field_updates": {"status": "duplicate"},
                "rationale": "Human rejected this ledger.",
            },
            "confidence_score": 0.88,
        }


class HumanEvidenceBadClient:
    """Fake client that violates the evidence-request protocol."""

    def complete_json(self, *_args, **_kwargs):
        return {
            "hypothesis_generation": [
                {
                    "claim": "Incorrectly finalizes evidence request.",
                    "evidence_fields": ["human_decision"],
                    "expected_impact": "Would skip evidence gathering.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Check human decision.",
                    "required_fields": ["human_decision"],
                    "failure_condition": "Human did not request evidence.",
                }
            ],
            "state_weights": {"bad_finalize": 0.9},
            "required_evidence": ["human_decision"],
            "proposed_action": {
                "action": "finalize_ledger",
                "ledger_id": 1042,
                "field_updates": {"status": "approved"},
                "rationale": "This should be blocked.",
            },
            "confidence_score": 0.5,
        }


class ListShapeRetryClient:
    """Fake client that fixes list-shaped fields after a protocol retry."""

    def __init__(self) -> None:
        self.calls = 0

    def complete_json(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            return {
                "hypothesis_generation": {
                    "claim": "Wrong shape.",
                    "evidence_fields": ["description"],
                    "expected_impact": "Should be an array.",
                },
                "falsification_testing": {
                    "test": "Wrong shape.",
                    "required_fields": ["description"],
                    "failure_condition": "Should be an array.",
                },
                "state_weights": {"shape_risk": 0.5},
                "required_evidence": ["description"],
                "proposed_action": {
                    "action": "request_human_review",
                    "ledger_id": 1042,
                    "field_updates": {"status": "review"},
                    "rationale": "First response is malformed.",
                },
                "confidence_score": 0.4,
            }

        return {
            "hypothesis_generation": [
                {
                    "claim": "Ledger should move to review.",
                    "evidence_fields": ["description"],
                    "expected_impact": "Route row to human review.",
                }
            ],
            "falsification_testing": [
                {
                    "test": "Check ledger evidence.",
                    "required_fields": ["description"],
                    "failure_condition": "Evidence is sufficient.",
                }
            ],
            "state_weights": {"shape_risk": 0.5},
            "required_evidence": ["description"],
            "proposed_action": {
                "action": "request_human_review",
                "ledger_id": 1042,
                "field_updates": {"status": "review"},
                "rationale": "Second response follows the schema.",
            },
            "confidence_score": 0.77,
        }


class PlaceholderRetryClient(StatusUpdateClient):
    """Fake client that replaces copied contract text after one retry."""

    def __init__(self) -> None:
        self.calls = 0

    def complete_json(self, *_args, **_kwargs):
        self.calls += 1
        response = super().complete_json(*_args, **_kwargs)
        if self.calls == 1:
            response["hypothesis_generation"][0]["claim"] = "short string"
            response["falsification_testing"][0]["test"] = "short string"
        return response


def test_optimization_response_contract_accepts_structured_payload() -> None:
    payload = {
        "hypothesis_generation": [
            {
                "claim": "Invoice may duplicate a prior freight charge.",
                "evidence_fields": ["description", "amount", "department"],
                "expected_impact": "Prevent duplicate expense recognition.",
            }
        ],
        "falsification_testing": [
            {
                "test": "Search for prior matching freight charges.",
                "required_fields": ["vendor", "amount", "transaction_date"],
                "failure_condition": "No matching vendor and amount window found.",
            }
        ],
        "state_weights": {"duplicate_risk": 0.82, "policy_risk": 0.33},
        "required_evidence": ["vendor", "receipt_id"],
        "proposed_action": {
            "action": "request_human_review",
            "ledger_id": 1042,
            "field_updates": {},
            "rationale": "Evidence is incomplete until vendor data is checked.",
        },
        "confidence_score": 0.74,
    }

    response = OptimizationResponse.model_validate(payload)

    assert response.confidence_score == 0.74
    assert response.proposed_action.action == "request_human_review"


def test_build_messages_prohibits_freeform_model_output() -> None:
    request = OptimizationRequest(
        document_evidence=[
            {
                "id": 7,
                "document_type": "invoice",
                "file_name": "invoice-1042.txt",
                "description": "Vendor invoice support",
                "extraction_status": "ready",
                "extracted_text": "Invoice total: 18420.00",
            }
        ],
        ledger_record=LedgerRecord(
            id=1042,
            description="Vendor invoice variance",
            amount="18420.00",
            department="Operations",
            status="review",
        )
    )

    messages = build_messages(request)

    assert messages[0]["role"] == "system"
    assert "Return exactly one valid compact JSON object" in messages[0]["content"]
    assert "untrusted evidence" in messages[0]["content"]
    assert "permitted_database_actions" in messages[1]["content"]
    assert '"file_name": "invoice-1042.txt"' in messages[1]["content"]
    assert "human_decision_protocol" in messages[1]["content"]
    assert "response_contract" in messages[1]["content"]
    assert '"ledger_id": 1042' in messages[1]["content"]


def test_optimizer_reports_protocol_violation_for_missing_contract_field() -> None:
    ledger_row = {
        "id": 1042,
        "description": "Vendor invoice variance",
        "amount": "18420.00",
        "department": "Operations",
        "status": "review",
    }

    with pytest.raises(ValueError) as exc_info:
        optimize_ledger_record(ledger_row, client=MissingConfidenceClient())

    assert str(exc_info.value) == (
        "Agent abligation protocol: agent failed to follow "
        "'PROTOCOL IS VIOLATED' by 'MISSING_COLUMN_CONFIDENCE_SCORE'"
    )


def test_optimizer_allows_explicit_ledger_status_update() -> None:
    ledger_row = {
        "id": 1042,
        "description": "Vendor invoice variance",
        "amount": "18420.00",
        "department": "Operations",
        "status": "pending",
    }

    response = optimize_ledger_record(ledger_row, client=StatusUpdateClient())

    assert response.proposed_action.field_updates == {"status": "review"}


def test_optimizer_retries_once_after_ledger_id_mismatch() -> None:
    class LedgerIdRetryClient(StatusUpdateClient):
        def __init__(self) -> None:
            self.calls = 0

        def complete_json(
            self, messages: list[dict[str, str]], max_tokens: int
        ) -> dict:
            self.calls += 1
            response = super().complete_json(messages, max_tokens)
            response["proposed_action"]["ledger_id"] = (
                9999 if self.calls == 1 else 1042
            )
            return response

    client = LedgerIdRetryClient()
    response = optimize_ledger_record(
        {
            "id": 1042,
            "description": "Vendor invoice variance",
            "amount": "18420.00",
            "department": "Operations",
            "status": "pending",
        },
        client=client,
    )

    assert client.calls == 2
    assert response.proposed_action.ledger_id == 1042


def test_optimizer_rejects_read_only_ledger_column_update() -> None:
    ledger_row = {
        "id": 1042,
        "description": "Vendor invoice variance",
        "amount": "18420.00",
        "department": "Operations",
        "status": "pending",
    }

    with pytest.raises(ValueError) as exc_info:
        optimize_ledger_record(ledger_row, client=ReadOnlyColumnClient())

    assert str(exc_info.value) == (
        "Agent abligation protocol: agent failed to follow "
        "'PROTOCOL IS VIOLATED' by 'READ_ONLY_COLUMN_ERP_LEDGER.AMOUNT'"
    )


def test_correction_candidate_requires_a_status_update() -> None:
    class EmptyCorrectionClient(StatusUpdateClient):
        def complete_json(
            self, messages: list[dict[str, str]], max_tokens: int
        ) -> dict:
            response = super().complete_json(messages, max_tokens)
            response["proposed_action"]["action"] = "create_correction_candidate"
            response["proposed_action"]["field_updates"] = {}
            return response

    with pytest.raises(ValueError) as exc_info:
        optimize_ledger_record(
            {
                "id": 1042,
                "description": "Vendor invoice variance",
                "amount": "18420.00",
                "department": "Operations",
                "status": "pending",
            },
            client=EmptyCorrectionClient(),
        )

    assert str(exc_info.value) == (
        "Agent abligation protocol: agent failed to follow "
        "'PROTOCOL IS VIOLATED' by "
        "'CORRECTION_CANDIDATE_REQUIRES_STATUS_UPDATE'"
    )


def test_correction_candidate_requires_a_changed_status() -> None:
    class NoOpCorrectionClient(StatusUpdateClient):
        def complete_json(
            self, messages: list[dict[str, str]], max_tokens: int
        ) -> dict:
            response = super().complete_json(messages, max_tokens)
            response["proposed_action"]["action"] = "create_correction_candidate"
            response["proposed_action"]["field_updates"] = {"status": "pending"}
            return response

    with pytest.raises(ValueError) as exc_info:
        optimize_ledger_record(
            {
                "id": 1042,
                "description": "Vendor invoice variance",
                "amount": "18420.00",
                "department": "Operations",
                "status": "pending",
            },
            client=NoOpCorrectionClient(),
        )

    assert str(exc_info.value) == (
        "Agent abligation protocol: agent failed to follow "
        "'PROTOCOL IS VIOLATED' by "
        "'CORRECTION_CANDIDATE_REQUIRES_CHANGED_STATUS'"
    )


def test_human_approved_protocol_allows_final_approval_status() -> None:
    response = optimize_ledger_record(
        {
            "id": 1042,
            "description": "Vendor invoice variance",
            "amount": "18420.00",
            "department": "Operations",
            "status": "review",
        },
        client=HumanApprovedClient(),
        human_decision=HumanReviewDecision(action="approved"),
    )

    assert response.proposed_action.action == "finalize_ledger"
    assert response.proposed_action.field_updates == {"status": "approved"}


def test_human_evidence_protocol_keeps_ledger_in_review() -> None:
    response = optimize_ledger_record(
        {
            "id": 1042,
            "description": "Vendor invoice variance",
            "amount": "18420.00",
            "department": "Operations",
            "status": "review",
        },
        client=HumanEvidenceClient(),
        human_decision=HumanReviewDecision(
            action="evidence",
            prompt="Find the source invoice before approval.",
        ),
    )

    assert response.proposed_action.action == "gather_evidence"
    assert response.proposed_action.field_updates == {"status": "review"}
    assert response.required_evidence == ["invoice_id", "vendor_name"]


def test_human_rejected_protocol_marks_duplicate_without_delete() -> None:
    response = optimize_ledger_record(
        {
            "id": 1042,
            "description": "Vendor invoice variance",
            "amount": "18420.00",
            "department": "Operations",
            "status": "review",
        },
        client=HumanRejectedClient(),
        human_decision=HumanReviewDecision(action="rejected"),
    )

    assert response.proposed_action.action == "mark_duplicate"
    assert response.proposed_action.field_updates == {"status": "duplicate"}


def test_human_evidence_protocol_rejects_finalization() -> None:
    with pytest.raises(ValueError) as exc_info:
        optimize_ledger_record(
            {
                "id": 1042,
                "description": "Vendor invoice variance",
                "amount": "18420.00",
                "department": "Operations",
                "status": "review",
            },
            client=HumanEvidenceBadClient(),
            human_decision=HumanReviewDecision(action="evidence"),
        )

    assert str(exc_info.value) == (
        "Agent abligation protocol: agent failed to follow "
        "'PROTOCOL IS VIOLATED' by "
        "'HUMAN_EVIDENCE_REQUEST_CANNOT_FINALIZE_OR_DROP'"
    )


def test_optimizer_retries_once_when_list_fields_have_wrong_shape() -> None:
    client = ListShapeRetryClient()

    response = optimize_ledger_record(
        {
            "id": 1042,
            "description": "Vendor invoice variance",
            "amount": "18420.00",
            "department": "Operations",
            "status": "pending",
        },
        client=client,
    )

    assert client.calls == 2
    assert response.confidence_score == 0.77
    assert response.hypothesis_generation[0].claim == "Ledger should move to review."


def test_optimizer_retries_copied_telemetry_placeholders() -> None:
    client = PlaceholderRetryClient()

    response = optimize_ledger_record(
        {
            "id": 1042,
            "description": "Vendor invoice variance",
            "amount": "18420.00",
            "department": "Operations",
            "status": "pending",
        },
        client=client,
    )

    assert client.calls == 2
    assert response.hypothesis_generation[0].claim == "Ledger should move to review."
    assert response.falsification_testing[0].test == (
        "Confirm source evidence is incomplete."
    )
