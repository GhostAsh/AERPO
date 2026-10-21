"""Vercel Python Function exposing the constrained ledger optimizer."""

from __future__ import annotations

from typing import Any

from flask import Flask, jsonify, request

from backend.nebius_client import NebiusClientError
from backend.run_optimizer_batch import run_optimizer_batch
from backend.supabase_client import SupabaseClient, SupabaseClientError


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024


@app.get("/api/optimizer/health")
def optimizer_health() -> tuple[Any, int]:
    """Reports that the Python runtime loaded without touching external APIs."""

    return jsonify({"ok": True, "runtime": "python"}), 200


@app.post("/api/optimizer/run")
def optimizer_run() -> tuple[Any, int]:
    """Runs the allowlisted optimizer batch for one ledger or the next batch."""

    payload = request.get_json(silent=True)
    if payload is None:
        payload = {}

    if not isinstance(payload, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    ledger_id = payload.get("ledgerId")
    if ledger_id is not None and (
        isinstance(ledger_id, bool)
        or not isinstance(ledger_id, int)
        or ledger_id <= 0
    ):
        return jsonify({"error": "ledgerId must be a positive integer."}), 400

    try:
        result = run_optimizer_batch(
            SupabaseClient(),
            ledger_id=ledger_id,
        )
    except (NebiusClientError, SupabaseClientError, ValueError) as exc:
        app.logger.warning("Optimizer request rejected: %s", exc)
        return jsonify({"error": str(exc)}), 500
    except Exception:
        app.logger.exception("Unexpected optimizer failure")
        return jsonify({"error": "Optimizer failed unexpectedly."}), 500

    return jsonify(result), 200
