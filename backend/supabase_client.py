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
        api_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv(
            "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        )

        if not url:
            raise SupabaseClientError("NEXT_PUBLIC_SUPABASE_URL is not set")
        if not api_key:
            raise SupabaseClientError(
                "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set"
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

        inserted = self._post("/rest/v1/ledger_correction_proposals", [row])
        if not isinstance(inserted, list) or not inserted:
            raise SupabaseClientError("Supabase correction insert returned no row")
        if not isinstance(inserted[0], dict):
            raise SupabaseClientError(
                "Supabase correction insert returned unexpected shape"
            )
        return inserted[0]

    def update_erp_ledger_status(self, ledger_id: int, status: str) -> dict[str, Any]:
        """Updates only public.erp_ledger.status and returns the changed row."""

        updated = self._patch(f"/rest/v1/erp_ledger?id=eq.{ledger_id}", {"status": status})
        if not isinstance(updated, list) or not updated:
            raise SupabaseClientError("Supabase ledger status update returned no row")
        if not isinstance(updated[0], dict):
            raise SupabaseClientError(
                "Supabase ledger status update returned unexpected shape"
            )
        return updated[0]

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
        url = f"{self.settings.url}{path}"
        request = urllib.request.Request(
            url,
            headers={
                "apikey": self.settings.api_key,
                "Authorization": f"Bearer {self.settings.api_key}",
                "Content-Type": "application/json",
            },
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
        url = f"{self.settings.url}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "apikey": self.settings.api_key,
                "Authorization": f"Bearer {self.settings.api_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
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
        url = f"{self.settings.url}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "apikey": self.settings.api_key,
                "Authorization": f"Bearer {self.settings.api_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
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
