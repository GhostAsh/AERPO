"""Minimal Supabase REST client for telemetry writes."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from backend.nebius_client import load_local_env


class SupabaseClientError(RuntimeError):
    """Raised when Supabase settings or REST calls fail."""


class SupabaseSafeWriteError(SupabaseClientError):
    """Raised when a write violates the local database mutation protocol."""


ALLOWED_LEDGER_STATUS_VALUES = frozenset(
    {"pending", "review", "approved", "duplicate"}
)

CORRECTION_PROPOSAL_FIELDS = frozenset(
    {
        "ledger_id",
        "telemetry_id",
        "target_table",
        "target_column",
        "before_value",
        "proposed_value",
        "evidence",
        "rationale",
        "confidence_score",
    }
)

ALLOWED_REST_OPERATIONS = {
    "GET": frozenset({"erp_ledger", "ledger_correction_proposals"}),
    "PATCH": frozenset({"erp_ledger"}),
    "POST": frozenset({"agent_telemetry", "ledger_correction_proposals"}),
}


def safe_write_protocol_violation(reason: str) -> SupabaseSafeWriteError:
    """Builds a stable operator-facing error for rejected database writes."""

    return SupabaseSafeWriteError(
        f"Supabase safe-write protocol blocked request: {reason}"
    )


def format_supabase_network_error(reason: object) -> str:
    """Returns a human-readable message for local network/socket failures."""

    reason_text = str(reason)
    if "WinError 10013" in reason_text:
        return (
            "Supabase network access blocked: Windows refused the outbound "
            "socket connection. Check firewall, antivirus, VPN, or sandbox "
            "network permissions before rerunning the optimizer."
        )

    return f"Supabase REST request failed: {reason_text}"


@dataclass(frozen=True)
class SupabaseSettings:
    """Runtime Supabase settings loaded from local environment variables."""

    url: str
    api_key: str

    @classmethod
    def from_env(cls) -> "SupabaseSettings":
        load_local_env()

        url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        api_key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv(
            "SUPABASE_SERVICE_ROLE_KEY"
        )

        if not url:
            raise SupabaseClientError("NEXT_PUBLIC_SUPABASE_URL is not set")
        if not api_key:
            raise SupabaseClientError(
                "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required "
                "for backend database access"
            )

        return cls(url=url.rstrip("/"), api_key=api_key)


class SupabaseClient:
    """Small REST client scoped to backend smoke-test telemetry inserts."""

    def __init__(self, settings: SupabaseSettings | None = None) -> None:
        self.settings = settings or SupabaseSettings.from_env()

    def insert_agent_telemetry(self, row: dict[str, Any]) -> dict[str, Any]:
        """Inserts one row into public.agent_telemetry and returns it."""

        inserted = self._post("/rest/v1/agent_telemetry", [row])
        if not isinstance(inserted, list) or not inserted:
            raise SupabaseClientError("Supabase insert returned no row")
        if not isinstance(inserted[0], dict):
            raise SupabaseClientError("Supabase insert returned unexpected shape")
        return inserted[0]

    def insert_ledger_correction_proposal(
        self, row: dict[str, Any]
    ) -> dict[str, Any]:
        """Queues one correction proposal without mutating the ledger."""

        self._validate_correction_proposal(row)
        inserted = self._post("/rest/v1/ledger_correction_proposals", [row])
        if not isinstance(inserted, list) or len(inserted) != 1:
            raise SupabaseClientError("Supabase correction insert returned no row")
        if not isinstance(inserted[0], dict):
            raise SupabaseClientError(
                "Supabase correction insert returned unexpected shape"
            )
        if inserted[0].get("ledger_id") != row["ledger_id"]:
            raise safe_write_protocol_violation("CORRECTION_LEDGER_ID_MISMATCH")
        if inserted[0].get("telemetry_id") != row["telemetry_id"]:
            raise safe_write_protocol_violation("CORRECTION_TELEMETRY_ID_MISMATCH")
        return inserted[0]

    def get_pending_ledger_correction_proposal(
        self,
        ledger_id: int,
    ) -> dict[str, Any] | None:
        """Returns the active status correction for a ledger, when present."""

        self._validate_positive_identifier(ledger_id, "LEDGER_ID")
        rows = self._get(
            "/rest/v1/ledger_correction_proposals"
            "?select=id,ledger_id,telemetry_id,target_table,target_column,review_status,execution_status"
            f"&ledger_id=eq.{ledger_id}"
            "&target_table=eq.erp_ledger"
            "&target_column=eq.status"
            "&review_status=eq.pending"
            "&limit=1"
        )
        if not isinstance(rows, list):
            raise SupabaseClientError(
                "Supabase pending correction query returned unexpected shape"
            )
        if not rows:
            return None
        if not isinstance(rows[0], dict):
            raise SupabaseClientError(
                "Supabase pending correction query returned unexpected shape"
            )
        if rows[0].get("ledger_id") != ledger_id:
            raise safe_write_protocol_violation("CORRECTION_LEDGER_ID_MISMATCH")
        return rows[0]

    def queue_ledger_correction_proposal(
        self,
        row: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        """Creates a proposal once or reuses the ledger's pending proposal."""

        self._validate_correction_proposal(row)
        existing = self.get_pending_ledger_correction_proposal(row["ledger_id"])
        if existing is not None:
            return existing, False

        try:
            return self.insert_ledger_correction_proposal(row), True
        except SupabaseClientError as exc:
            if not self._is_pending_correction_conflict(exc):
                raise

            existing = self.get_pending_ledger_correction_proposal(row["ledger_id"])
            if existing is None:
                raise
            return existing, False

    def update_erp_ledger_status(self, ledger_id: int, status: str) -> dict[str, Any]:
        """Updates only public.erp_ledger.status and returns the changed row."""

        self._validate_positive_identifier(ledger_id, "LEDGER_ID")
        if status not in ALLOWED_LEDGER_STATUS_VALUES:
            raise safe_write_protocol_violation(
                "DISALLOWED_VALUE_ERP_LEDGER.STATUS"
            )

        updated = self._patch(f"/rest/v1/erp_ledger?id=eq.{ledger_id}", {"status": status})
        if not isinstance(updated, list) or len(updated) != 1:
            raise SupabaseClientError("Supabase ledger status update returned no row")
        if not isinstance(updated[0], dict):
            raise SupabaseClientError(
                "Supabase ledger status update returned unexpected shape"
            )
        if updated[0].get("id") != ledger_id:
            raise safe_write_protocol_violation("LEDGER_ID_MISMATCH")
        if updated[0].get("status") != status:
            raise safe_write_protocol_violation("LEDGER_STATUS_MISMATCH")
        return updated[0]

    @staticmethod
    def _validate_positive_identifier(value: object, field: str) -> None:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise safe_write_protocol_violation(f"INVALID_{field}")

    @staticmethod
    def _is_pending_correction_conflict(exc: SupabaseClientError) -> bool:
        message = str(exc)
        return (
            "Supabase REST error 409" in message
            and '"code":"23505"' in message
            and "ledger_correction_one_pending_target_idx" in message
        )

    @classmethod
    def _validate_correction_proposal(cls, row: dict[str, Any]) -> None:
        fields = set(row)
        missing_fields = CORRECTION_PROPOSAL_FIELDS - fields
        if missing_fields:
            missing = "_AND_".join(sorted(field.upper() for field in missing_fields))
            raise safe_write_protocol_violation(f"MISSING_COLUMN_{missing}")

        extra_fields = fields - CORRECTION_PROPOSAL_FIELDS
        if extra_fields:
            extra = "_AND_".join(sorted(field.upper() for field in extra_fields))
            raise safe_write_protocol_violation(f"UNEXPECTED_COLUMN_{extra}")

        cls._validate_positive_identifier(row["ledger_id"], "LEDGER_ID")
        cls._validate_positive_identifier(row["telemetry_id"], "TELEMETRY_ID")

        if row["target_table"] != "erp_ledger":
            raise safe_write_protocol_violation("TARGET_TABLE_NOT_ALLOWLISTED")
        if row["target_column"] != "status":
            raise safe_write_protocol_violation(
                f"READ_ONLY_COLUMN_ERP_LEDGER.{str(row['target_column']).upper()}"
            )

        before_value = row["before_value"]
        proposed_value = row["proposed_value"]
        if before_value is not None and before_value not in ALLOWED_LEDGER_STATUS_VALUES:
            raise safe_write_protocol_violation(
                "INVALID_CAPTURED_VALUE_ERP_LEDGER.STATUS"
            )
        if proposed_value not in ALLOWED_LEDGER_STATUS_VALUES:
            raise safe_write_protocol_violation(
                "DISALLOWED_VALUE_ERP_LEDGER.STATUS"
            )
        if before_value == proposed_value:
            raise safe_write_protocol_violation(
                "CORRECTION_CANDIDATE_REQUIRES_CHANGED_STATUS"
            )

        evidence = row["evidence"]
        if (
            not isinstance(evidence, list)
            or not evidence
            or any(not isinstance(item, str) or not item.strip() for item in evidence)
        ):
            raise safe_write_protocol_violation("INVALID_CORRECTION_EVIDENCE")

        rationale = row["rationale"]
        if not isinstance(rationale, str) or not rationale.strip():
            raise safe_write_protocol_violation("INVALID_CORRECTION_RATIONALE")

        confidence = row["confidence_score"]
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not 0 <= confidence <= 1
        ):
            raise safe_write_protocol_violation("INVALID_CONFIDENCE_SCORE")

    def list_erp_ledger(self, limit: int = 25) -> list[dict[str, Any]]:
        """Returns recent ledger rows for optimizer inspection."""

        rows = self._get(
            "/rest/v1/erp_ledger"
            "?select=id,transaction_date,description,amount,department,status,optimization_notes"
            f"&order=transaction_date.desc,id.desc&limit={limit}"
        )
        if not isinstance(rows, list):
            raise SupabaseClientError("Supabase ledger query returned unexpected shape")
        return [row for row in rows if isinstance(row, dict)]

    def get_erp_ledger(self, ledger_id: int) -> dict[str, Any] | None:
        """Returns one ledger row by its numeric identifier."""

        rows = self._get(
            "/rest/v1/erp_ledger"
            "?select=id,transaction_date,description,amount,department,status,optimization_notes"
            f"&id=eq.{ledger_id}&limit=1"
        )
        if not isinstance(rows, list):
            raise SupabaseClientError("Supabase ledger query returned unexpected shape")
        if not rows:
            return None
        if not isinstance(rows[0], dict):
            raise SupabaseClientError("Supabase ledger query returned unexpected shape")
        return rows[0]

    def _get(self, path: str) -> Any:
        self._validate_rest_operation("GET", path)
        url = f"{self.settings.url}{path}"
        request = urllib.request.Request(
            url,
            headers=self._request_headers(),
            method="GET",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise SupabaseClientError(
                f"Supabase REST error {exc.code}: {details}"
            ) from exc
        except urllib.error.URLError as exc:
            raise SupabaseClientError(format_supabase_network_error(exc.reason)) from exc

        try:
            return json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise SupabaseClientError("Supabase returned non-JSON data") from exc

    def _patch(self, path: str, payload: Any) -> Any:
        self._validate_rest_operation("PATCH", path)
        url = f"{self.settings.url}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers=self._request_headers(prefer="return=representation"),
            method="PATCH",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise SupabaseClientError(
                f"Supabase REST error {exc.code}: {details}"
            ) from exc
        except urllib.error.URLError as exc:
            raise SupabaseClientError(format_supabase_network_error(exc.reason)) from exc

        try:
            return json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise SupabaseClientError("Supabase returned non-JSON data") from exc

    def _post(self, path: str, payload: Any) -> Any:
        self._validate_rest_operation("POST", path)
        url = f"{self.settings.url}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers=self._request_headers(prefer="return=representation"),
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise SupabaseClientError(
                f"Supabase REST error {exc.code}: {details}"
            ) from exc
        except urllib.error.URLError as exc:
            raise SupabaseClientError(format_supabase_network_error(exc.reason)) from exc

        try:
            return json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise SupabaseClientError("Supabase returned non-JSON data") from exc

    @staticmethod
    def _validate_rest_operation(method: str, path: str) -> None:
        resources = ALLOWED_REST_OPERATIONS.get(method)
        if resources is None:
            raise safe_write_protocol_violation(f"HTTP_METHOD_{method}_BLOCKED")
        if not path.startswith("/rest/v1/"):
            raise safe_write_protocol_violation("NON_REST_PATH_BLOCKED")

        resource = path.removeprefix("/rest/v1/").split("?", maxsplit=1)[0]
        if resource not in resources:
            raise safe_write_protocol_violation(
                f"{method}_{resource.upper() or 'EMPTY_RESOURCE'}_BLOCKED"
            )

    def _request_headers(self, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.settings.api_key,
            "Content-Type": "application/json",
        }
        if not self.settings.api_key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {self.settings.api_key}"
        if prefer:
            headers["Prefer"] = prefer
        return headers
