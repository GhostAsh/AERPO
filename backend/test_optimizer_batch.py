"""Tests for optimizer batch side effects."""

from backend.run_optimizer_batch import run_optimizer_batch
from backend.schemas import OptimizationResponse


class FakeSupabase:
    """Captures telemetry inserts and ledger status updates."""

    def __init__(self) -> None:
        self.correction_rows: list[dict] = []
        self.telemetry_rows: list[dict] = []
        self.status_updates: list[dict] = []

    def list_erp_ledger(self, limit: int = 25) -> list[dict]:
        return [
            {
                "id": 1042,
                "description": "Vendor invoice variance",
                "amount": "18420.00",
                "department": "Operations",
                "status": "pending",
            }
        ]

    def get_erp_ledger(self, ledger_id: int) -> dict | None:
        return self.list_erp_ledger()[0] if ledger_id == 1042 else None

    def insert_agent_telemetry(self, row: dict) -> dict:
        inserted = {"id": len(self.telemetry_rows) + 1, **row}
        self.telemetry_rows.append(inserted)
        return inserted

    def insert_ledger_correction_proposal(self, row: dict) -> dict:
        inserted = {"id": len(self.correction_rows) + 1, **row}
        self.correction_rows.append(inserted)
        return inserted

    def queue_ledger_correction_proposal(self, row: dict) -> tuple[dict, bool]:
        return self.insert_ledger_correction_proposal(row), True

    def update_erp_ledger_status(self, ledger_id: int, status: str) -> dict:
        updated = {"id": ledger_id, "status": status}
        self.status_updates.append(updated)
        return updated


def test_optimizer_batch_applies_protocol_approved_status_update(monkeypatch) -> None:
    def fake_optimizer(_ledger_row: dict) -> OptimizationResponse:
        return OptimizationResponse.model_validate(
            {
                "hypothesis_generation": [
                    {
                        "claim": "Ledger should move to review.",
                        "evidence_fields": ["status"],
                        "expected_impact": "Route row to human review.",
                    }
                ],
                "falsification_testing": [
                    {
                        "test": "Confirm evidence is incomplete.",
                        "required_fields": ["optimization_notes"],
                        "failure_condition": "Evidence is complete.",
                    }
                ],
                "state_weights": {"review_risk": 0.7},
                "required_evidence": ["optimization_notes"],
                "proposed_action": {
                    "action": "request_human_review",
                    "ledger_id": 1042,
                    "field_updates": {"status": "review"},
                    "rationale": "Human review is required.",
                },
                "confidence_score": 0.81,
            }
        )

    import backend.run_optimizer_batch as batch

    monkeypatch.setattr(batch, "optimize_ledger_record", fake_optimizer)
    result = run_optimizer_batch(FakeSupabase())

    assert result == {
        "correction_ids": [],
        "existing_correction_ids": [],
        "inspected": 1,
        "status_update_skipped": 0,
        "status_updates": [{"ledger_id": 1042, "status": "review"}],
        "telemetry_ids": [1],
    }


def test_targeted_optimizer_only_inspects_requested_ledger(monkeypatch) -> None:
    class TargetedSupabase(FakeSupabase):
        def list_erp_ledger(self, limit: int = 25) -> list[dict]:
            raise AssertionError("Targeted review must not load the batch queue")

        def get_erp_ledger(self, ledger_id: int) -> dict | None:
            assert ledger_id == 1042
            return {
                "id": ledger_id,
                "description": "Vendor invoice variance",
                "amount": "18420.00",
                "department": "Operations",
                "status": "pending",
            }

    def fake_optimizer(ledger_row: dict) -> OptimizationResponse:
        assert ledger_row["id"] == 1042
        return OptimizationResponse.model_validate(
            {
                "hypothesis_generation": [
                    {
                        "claim": "Ledger should move to review.",
                        "evidence_fields": ["status"],
                        "expected_impact": "Route row to human review.",
                    }
                ],
                "falsification_testing": [
                    {
                        "test": "Confirm evidence is incomplete.",
                        "required_fields": ["optimization_notes"],
                        "failure_condition": "Evidence is complete.",
                    }
                ],
                "state_weights": {"review_risk": 0.7},
                "required_evidence": ["optimization_notes"],
                "proposed_action": {
                    "action": "request_human_review",
                    "ledger_id": 1042,
                    "field_updates": {"status": "review"},
                    "rationale": "Human review is required.",
                },
                "confidence_score": 0.81,
            }
        )

    import backend.run_optimizer_batch as batch

    monkeypatch.setattr(batch, "optimize_ledger_record", fake_optimizer)
    result = run_optimizer_batch(TargetedSupabase(), ledger_id=1042)

    assert result["inspected"] == 1
    assert result["status_updates"] == [
        {"ledger_id": 1042, "status": "review"}
    ]


def test_correction_candidate_is_queued_without_ledger_mutation(monkeypatch) -> None:
    def fake_optimizer(_ledger_row: dict) -> OptimizationResponse:
        return OptimizationResponse.model_validate(
            {
                "hypothesis_generation": [
                    {
                        "claim": "Ledger status needs correction.",
                        "evidence_fields": ["status"],
                        "expected_impact": "Route row to review.",
                    }
                ],
                "falsification_testing": [
                    {
                        "test": "Confirm the current status is still pending.",
                        "required_fields": ["status"],
                        "failure_condition": "Status changed after analysis.",
                    }
                ],
                "state_weights": {"review_risk": 0.8},
                "required_evidence": ["status"],
                "proposed_action": {
                    "action": "create_correction_candidate",
                    "ledger_id": 1042,
                    "field_updates": {"status": "review"},
                    "rationale": "Human approval is required.",
                },
                "confidence_score": 0.88,
            }
        )

    import backend.run_optimizer_batch as batch

    monkeypatch.setattr(batch, "optimize_ledger_record", fake_optimizer)
    supabase = FakeSupabase()
    result = run_optimizer_batch(supabase)

    assert result["correction_ids"] == [1]
    assert result["existing_correction_ids"] == []
    assert result["status_updates"] == []
    assert result["status_update_skipped"] == 1
    assert supabase.status_updates == []
    assert supabase.correction_rows[0]["before_value"] == "pending"
    assert supabase.correction_rows[0]["proposed_value"] == "review"


def test_same_value_correction_is_skipped_before_database_insert(monkeypatch) -> None:
    def fake_optimizer(_ledger_row: dict) -> OptimizationResponse:
        return OptimizationResponse.model_validate(
            {
                "hypothesis_generation": [
                    {
                        "claim": "Ledger remains pending.",
                        "evidence_fields": ["status"],
                        "expected_impact": "No status change.",
                    }
                ],
                "falsification_testing": [
                    {
                        "test": "Confirm the current status.",
                        "required_fields": ["status"],
                        "failure_condition": "Status is not pending.",
                    }
                ],
                "state_weights": {"review_risk": 0.4},
                "required_evidence": ["status"],
                "proposed_action": {
                    "action": "create_correction_candidate",
                    "ledger_id": 1042,
                    "field_updates": {"status": "pending"},
                    "rationale": "No effective change was proposed.",
                },
                "confidence_score": 0.75,
            }
        )

    import backend.run_optimizer_batch as batch

    monkeypatch.setattr(batch, "optimize_ledger_record", fake_optimizer)
    supabase = FakeSupabase()
    result = run_optimizer_batch(supabase)

    assert result["correction_ids"] == []
    assert result["existing_correction_ids"] == []
    assert result["telemetry_ids"] == [1]
    assert result["status_updates"] == []
    assert result["status_update_skipped"] == 1
    assert supabase.correction_rows == []


def test_existing_pending_correction_is_reused_without_batch_failure(
    monkeypatch,
) -> None:
    class ExistingCorrectionSupabase(FakeSupabase):
        def queue_ledger_correction_proposal(
            self,
            row: dict,
        ) -> tuple[dict, bool]:
            assert row["ledger_id"] == 1042
            assert row["target_column"] == "status"
            return {
                "id": 91,
                "ledger_id": 1042,
                "telemetry_id": 12,
                "target_table": "erp_ledger",
                "target_column": "status",
            }, False

    def fake_optimizer(_ledger_row: dict) -> OptimizationResponse:
        return OptimizationResponse.model_validate(
            {
                "hypothesis_generation": [
                    {
                        "claim": "Ledger status still needs correction.",
                        "evidence_fields": ["status"],
                        "expected_impact": "Keep the existing review proposal.",
                    }
                ],
                "falsification_testing": [
                    {
                        "test": "Check for an active correction.",
                        "required_fields": ["status"],
                        "failure_condition": "No active correction exists.",
                    }
                ],
                "state_weights": {"review_risk": 0.8},
                "required_evidence": ["status"],
                "proposed_action": {
                    "action": "create_correction_candidate",
                    "ledger_id": 1042,
                    "field_updates": {"status": "review"},
                    "rationale": "Human approval remains required.",
                },
                "confidence_score": 0.88,
            }
        )

    import backend.run_optimizer_batch as batch

    monkeypatch.setattr(batch, "optimize_ledger_record", fake_optimizer)
    supabase = ExistingCorrectionSupabase()
    result = run_optimizer_batch(supabase)

    assert result["correction_ids"] == []
    assert result["existing_correction_ids"] == [91]
    assert result["telemetry_ids"] == [1]
    assert result["status_updates"] == []
    assert result["status_update_skipped"] == 1
    assert supabase.correction_rows == []
