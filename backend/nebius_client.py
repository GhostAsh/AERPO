"""Nebius Token Factory client using the OpenAI-compatible chat API."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
DEFAULT_MODEL = "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF"


class NebiusClientError(RuntimeError):
    """Raised when the Nebius API request fails or returns invalid data."""


@dataclass(frozen=True)
class NebiusSettings:
    """Runtime settings loaded from local environment variables."""

    api_key: str
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL

    @classmethod
    def from_env(cls) -> "NebiusSettings":
        load_local_env()

        api_key = os.getenv("NEBIUS_API_KEY")
        if not api_key:
            raise NebiusClientError("NEBIUS_API_KEY is not set")

        return cls(
            api_key=api_key,
            base_url=os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
            model=os.getenv("NEBIUS_MODEL", DEFAULT_MODEL),
        )


class NebiusClient:
    """Small OpenAI-compatible client scoped to structured chat completions."""

    def __init__(self, settings: NebiusSettings | None = None) -> None:
        self.settings = settings or NebiusSettings.from_env()

    def complete_json(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        payload = {
            "model": self.settings.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }

        response = self._post("/chat/completions", payload)
        try:
            content = response["choices"][0]["message"]["content"]
            parsed = json.loads(content)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            finish_reason = None
            content_length = None
            if isinstance(response.get("choices"), list) and response["choices"]:
                choice = response["choices"][0]
                if isinstance(choice, dict):
                    finish_reason = choice.get("finish_reason")
                    message = choice.get("message")
                    if isinstance(message, dict) and isinstance(
                        message.get("content"), str
                    ):
                        content_length = len(message["content"])
            raise NebiusClientError(
                "Nebius response did not contain valid JSON "
                f"(finish_reason={finish_reason}, content_length={content_length})"
            ) from exc

        if not isinstance(parsed, dict):
            raise NebiusClientError("Nebius response JSON must be an object")

        return parsed

    def list_models(self) -> list[str]:
        """Returns model IDs available to the configured Nebius API key."""

        response = self._get("/models")
        models = response.get("data")
        if not isinstance(models, list):
            raise NebiusClientError("Nebius models response did not include data")

        model_ids: list[str] = []
        for model in models:
            if isinstance(model, dict) and isinstance(model.get("id"), str):
                model_ids.append(model["id"])

        return sorted(model_ids)

    def _get(self, path: str) -> dict[str, Any]:
        url = f"{self.settings.base_url}{path}"
        request = urllib.request.Request(
            url,
            headers={
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
            raise NebiusClientError(f"Nebius API error {exc.code}: {details}") from exc
        except urllib.error.URLError as exc:
            raise NebiusClientError(f"Nebius API request failed: {exc.reason}") from exc

        try:
            parsed = json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise NebiusClientError("Nebius API returned non-JSON data") from exc

        if not isinstance(parsed, dict):
            raise NebiusClientError("Nebius API returned unexpected JSON shape")

        return parsed

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.settings.base_url}{path}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.settings.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise NebiusClientError(f"Nebius API error {exc.code}: {details}") from exc
        except urllib.error.URLError as exc:
            raise NebiusClientError(f"Nebius API request failed: {exc.reason}") from exc

        try:
            parsed = json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise NebiusClientError("Nebius API returned non-JSON data") from exc

        if not isinstance(parsed, dict):
            raise NebiusClientError("Nebius API returned unexpected JSON shape")

        return parsed


def load_local_env(path: str = ".env.local") -> None:
    """Loads simple KEY=value pairs without echoing malformed or secret lines."""

    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key or not key.replace("_", "").isalnum() or key[0].isdigit():
            continue

        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)
