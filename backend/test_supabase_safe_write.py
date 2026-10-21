"""Contract tests for the final Supabase database-write boundary."""

from __future__ import annotations

import json
from io import BytesIO
import urllib.error
import urllib.request
from typing import Any

import pytest

import backend.supabase_client as supabase_module
from backend.supabase_client import (
    SupabaseClient,
    SupabaseClientError,
    SupabaseSafeWriteError,
    SupabaseSettings,
)


class FakeResponse:
    """Small context-manager response used to test REST requests offline."""

    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def correction_proposal(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "ledger_id": 1042,
        "telemetry_id": 77,
        "target_table": "erp_ledger",
        "target_column": "status",
        "before_value": "pending",
        "proposed_value": "review",
        "evidence": ["status", "optimization_notes"],
        "rationale": "Route the ledger through human review.",
        "confidence_score": 0.88,
    }
    row.update(overrides)
    return row


def client() -> SupabaseClient:
    return SupabaseClient(
        SupabaseSettings(url="https://example.supabase.co", api_key="service-role")
    )


def capture_request(
    monkeypatch: pytest.MonkeyPatch,
    response_payload: Any,
) -> list[urllib.request.Request]:
    requests: list[urllib.request.Request] = []

    def fake_urlopen(
        request: urllib.request.Request,
        timeout: int,
    ) -> FakeResponse:
        assert timeout == 30
        requests.append(request)
        return FakeResponse(response_payload)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return requests


def assert_no_network_request(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_urlopen(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Protocol violations must stop before network access")

    monkeypatch.setattr(urllib.request, "urlopen", fail_urlopen)


def test_backend_settings_require_service_role_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(supabase_module, "load_local_env", lambda: None)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")

    with pytest.raises(SupabaseClientError, match="SUPABASE_SECRET_KEY or"):
        SupabaseSettings.from_env()


def test_backend_settings_prefer_server_secret_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(supabase_module, "load_local_env", lambda: None)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "preferred-secret")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role")

    settings = SupabaseSettings.from_env()

    assert settings.api_key == "preferred-secret"


def test_new_secret_key_is_not_sent_as_a_bearer_token() -> None:
    secret_client = SupabaseClient(
        SupabaseSettings(
            url="https://example.supabase.co",
            api_key="sb_secret_example",
        )
    )

    headers = secret_client._request_headers()

    assert headers["apikey"] == "sb_secret_example"
    assert "Authorization" not in headers


def test_legacy_service_role_key_is_sent_as_a_bearer_token() -> None:
    headers = client()._request_headers()

    assert headers["Authorization"] == "Bearer service-role"


@pytest.mark.parametrize(
    ("method", "path", "reason"),
    [
        ("DELETE", "/rest/v1/erp_ledger?id=eq.1042", "HTTP_METHOD_DELETE_BLOCKED"),
        ("PATCH", "/rest/v1/agent_telemetry?id=eq.77", "PATCH_AGENT_TELEMETRY_BLOCKED"),
        ("POST", "/rest/v1/erp_ledger", "POST_ERP_LEDGER_BLOCKED"),
        ("GET", "/auth/v1/users", "NON_REST_PATH_BLOCKED"),
    ],
)
def test_database_protocol_rejects_non_allowlisted_operations(
    method: str,
    path: str,
    reason: str,
) -> None:
    with pytest.raises(SupabaseSafeWriteError, match=reason):
        SupabaseClient._validate_rest_operation(method, path)


def test_status_update_sends_only_the_allowlisted_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = capture_request(
        monkeypatch,
        [{"id": 1042, "status": "review", "amount": "18420.00"}],
    )

    updated = client().update_erp_ledger_status(1042, "review")

    assert updated["status"] == "review"
    assert len(requests) == 1
    request = requests[0]
    assert request.get_method() == "PATCH"
    assert request.full_url.endswith("/rest/v1/erp_ledger?id=eq.1042")
    assert json.loads((request.data or b"").decode("utf-8")) == {
        "status": "review"
    }


@pytest.mark.parametrize("ledger_id", [0, -1, True, "1042"])
def test_status_update_rejects_invalid_ledger_id_before_network(
    monkeypatch: pytest.MonkeyPatch,
    ledger_id: object,
) -> None:
    assert_no_network_request(monkeypatch)

    with pytest.raises(SupabaseSafeWriteError, match="INVALID_LEDGER_ID"):
        client().update_erp_ledger_status(ledger_id, "review")  # type: ignore[arg-type]


@pytest.mark.parametrize("status", ["paid", "deleted", "", None])
def test_status_update_rejects_non_allowlisted_value_before_network(
    monkeypatch: pytest.MonkeyPatch,
    status: object,
) -> None:
    assert_no_network_request(monkeypatch)

    with pytest.raises(
        SupabaseSafeWriteError,
        match="DISALLOWED_VALUE_ERP_LEDGER.STATUS",
    ):
        client().update_erp_ledger_status(1042, status)  # type: ignore[arg-type]


def test_status_update_rejects_mismatched_database_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture_request(monkeypatch, [{"id": 9999, "status": "review"}])

    with pytest.raises(SupabaseSafeWriteError, match="LEDGER_ID_MISMATCH"):
        client().update_erp_ledger_status(1042, "review")


def test_correction_proposal_is_queued_without_a_ledger_patch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = correction_proposal()
    requests = capture_request(monkeypatch, [{"id": 8, **row}])

    inserted = client().insert_ledger_correction_proposal(row)

    assert inserted["id"] == 8
    assert len(requests) == 1
    request = requests[0]
    assert request.get_method() == "POST"
    assert request.full_url.endswith("/rest/v1/ledger_correction_proposals")
    assert json.loads((request.data or b"").decode("utf-8")) == [row]


def test_existing_pending_correction_is_reused_without_post(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = {
        "id": 91,
        "ledger_id": 1042,
        "telemetry_id": 12,
        "target_table": "erp_ledger",
        "target_column": "status",
        "review_status": "pending",
        "execution_status": "not_ready",
    }
    requests = capture_request(monkeypatch, [existing])

    proposal, created = client().queue_ledger_correction_proposal(
        correction_proposal()
    )

    assert proposal == existing
    assert created is False
    assert [request.get_method() for request in requests] == ["GET"]


def test_pending_correction_insert_race_reuses_winning_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing = {
        "id": 92,
        "ledger_id": 1042,
        "telemetry_id": 13,
        "target_table": "erp_ledger",
        "target_column": "status",
        "review_status": "pending",
        "execution_status": "not_ready",
    }
    requests: list[urllib.request.Request] = []

    def fake_urlopen(
        request: urllib.request.Request,
        timeout: int,
    ) -> FakeResponse:
        assert timeout == 30
        requests.append(request)
        if len(requests) == 1:
            return FakeResponse([])
        if len(requests) == 2:
            details = (
                b'{"code":"23505","details":"ledger_correction_one_pending_target_idx",'
                b'"message":"duplicate key value violates unique constraint"}'
            )
            raise urllib.error.HTTPError(
                request.full_url,
                409,
                "Conflict",
                hdrs=None,
                fp=BytesIO(details),
            )
        return FakeResponse([existing])

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    proposal, created = client().queue_ledger_correction_proposal(
        correction_proposal()
    )

    assert proposal == existing
    assert created is False
    assert [request.get_method() for request in requests] == ["GET", "POST", "GET"]


def test_correction_proposal_rejects_read_only_column_before_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert_no_network_request(monkeypatch)

    with pytest.raises(
        SupabaseSafeWriteError,
        match=r"READ_ONLY_COLUMN_ERP_LEDGER\.AMOUNT",
    ):
        client().insert_ledger_correction_proposal(
            correction_proposal(target_column="amount", proposed_value="100.00")
        )


def test_correction_proposal_requires_a_changed_value_before_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert_no_network_request(monkeypatch)

    with pytest.raises(
        SupabaseSafeWriteError,
        match="CORRECTION_CANDIDATE_REQUIRES_CHANGED_STATUS",
    ):
        client().insert_ledger_correction_proposal(
            correction_proposal(proposed_value="pending")
        )


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"evidence": []}, "INVALID_CORRECTION_EVIDENCE"),
        ({"rationale": ""}, "INVALID_CORRECTION_RATIONALE"),
        ({"confidence_score": 1.2}, "INVALID_CONFIDENCE_SCORE"),
        ({"proposed_value": "paid"}, "DISALLOWED_VALUE_ERP_LEDGER.STATUS"),
    ],
)
def test_correction_proposal_rejects_malformed_protocol_fields(
    monkeypatch: pytest.MonkeyPatch,
    overrides: dict[str, Any],
    reason: str,
) -> None:
    assert_no_network_request(monkeypatch)

    with pytest.raises(SupabaseSafeWriteError, match=reason):
        client().insert_ledger_correction_proposal(correction_proposal(**overrides))


def test_correction_proposal_rejects_unexpected_write_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert_no_network_request(monkeypatch)
    row = correction_proposal()
    row["amount"] = "100.00"

    with pytest.raises(SupabaseSafeWriteError, match="UNEXPECTED_COLUMN_AMOUNT"):
        client().insert_ledger_correction_proposal(row)
