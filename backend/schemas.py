"""Typed contracts for ledger optimization and model responses."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LedgerRecord(BaseModel):
    """Normalized ERP ledger row passed into the optimization loop."""

    model_config = ConfigDict(extra="forbid")

    id: int
    transaction_date: str | None = None
    description: str | None = None
    amount: Decimal | None = None
    department: str | None = None
    status: str | None = None
    optimization_notes: str | None = None


class Hypothesis(BaseModel):
    """Structured candidate explanation for a possible ledger correction."""

    model_config = ConfigDict(extra="forbid")

    claim: str
    evidence_fields: list[str] = Field(default_factory=list)
    expected_impact: str | None = None


class FalsificationTest(BaseModel):
    """Deterministic test that can disprove or weaken a hypothesis."""

    model_config = ConfigDict(extra="forbid")

    test: str
    required_fields: list[str] = Field(default_factory=list)
    failure_condition: str


class ProposedAction(BaseModel):
    """Action candidate that remains subject to Python and human approval."""

    model_config = ConfigDict(extra="forbid")

    action: Literal[
        "no_change",
        "request_human_review",
        "create_correction_candidate",
        "finalize_ledger",
        "gather_evidence",
        "mark_duplicate",
    ]
    ledger_id: int
    field_updates: dict[str, Any] = Field(default_factory=dict)
    rationale: str


class HumanReviewDecision(BaseModel):
    """Human decision context sent back into the agent protocol."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["approved", "evidence", "rejected"]
    prompt: str | None = None


class DatabaseActionPermission(BaseModel):
    """Database mutation permission exposed to the agent as a hard boundary."""

    model_config = ConfigDict(extra="forbid")

    table: Literal["erp_ledger"]
    operation: Literal["update"]
    columns: list[Literal["status"]]
    allowed_values: dict[
        Literal["status"], list[Literal["pending", "review", "approved", "duplicate"]]
    ]


class OptimizationResponse(BaseModel):
    """Strict model output contract consumed by the backend."""

    model_config = ConfigDict(extra="forbid")

    hypothesis_generation: list[Hypothesis]
    falsification_testing: list[FalsificationTest]
    state_weights: dict[str, float]
    required_evidence: list[str]
    proposed_action: ProposedAction
    confidence_score: float = Field(ge=0.0, le=1.0)

    @field_validator("state_weights")
    @classmethod
    def state_weights_are_probabilities(
        cls, value: dict[str, float]
    ) -> dict[str, float]:
        for key, weight in value.items():
            if weight < 0 or weight > 1:
                raise ValueError(f"state weight '{key}' must be between 0 and 1")
        return value


class OptimizationRequest(BaseModel):
    """Payload Python sends to the constrained inference model."""

    model_config = ConfigDict(extra="forbid")

    ledger_record: LedgerRecord
    allowed_actions: list[str] = Field(
        default_factory=lambda: [
            "no_change",
            "request_human_review",
            "create_correction_candidate",
            "finalize_ledger",
            "gather_evidence",
            "mark_duplicate",
        ]
    )
    human_decision: HumanReviewDecision | None = None
    human_decision_protocol: dict[str, str] = Field(
        default_factory=lambda: {
            "approved": (
                "Human approved the ledger; agent may finalize by proposing "
                "erp_ledger.status='approved'."
            ),
            "evidence": (
                "Human requested more evidence; agent must gather and display "
                "evidence while keeping the ledger in review."
            ),
            "rejected": (
                "Human rejected the ledger; agent must treat it as a duplicate "
                "candidate and may propose erp_ledger.status='duplicate'. Never delete."
            ),
        }
    )
    permitted_database_actions: list[DatabaseActionPermission] = Field(
        default_factory=lambda: [
            DatabaseActionPermission(
                table="erp_ledger",
                operation="update",
                columns=["status"],
                allowed_values={
                    "status": ["pending", "review", "approved", "duplicate"]
                },
            )
        ]
    )
    response_contract: dict[str, Any] = Field(
        default_factory=lambda: {
            "hypothesis_generation": [
                {
                    "claim": "short string",
                    "evidence_fields": ["field_name"],
                    "expected_impact": "short string",
                }
            ],
            "falsification_testing": [
                {
                    "test": "short string",
                    "required_fields": ["field_name"],
                    "failure_condition": "short string",
                }
            ],
            "state_weights": {"risk_name": 0.0},
            "required_evidence": ["field_name"],
            "proposed_action": {
                "action": (
                    "no_change | request_human_review | "
                    "create_correction_candidate | finalize_ledger | "
                    "gather_evidence | mark_duplicate"
                ),
                "ledger_id": 0,
                "field_updates": {
                    "status": "pending | review | approved | duplicate",
                },
                "rationale": "short string",
            },
            "confidence_score": 0.0,
        }
    )

    @model_validator(mode="after")
    def bind_response_contract_to_ledger(self) -> "OptimizationRequest":
        """Replaces the example ledger ID with the record being inspected."""

        proposed_action = self.response_contract.get("proposed_action")
        if isinstance(proposed_action, dict):
            proposed_action["ledger_id"] = self.ledger_record.id
        return self
