"""Health check for the Vercel Python optimizer runtime."""

from __future__ import annotations

from typing import Any

from flask import Flask, jsonify


app = Flask(__name__)


@app.get("/api/optimizer/health")
def optimizer_health() -> tuple[Any, int]:
    """Reports that the Python runtime loaded without external API calls."""

    return jsonify({"ok": True, "runtime": "python"}), 200
