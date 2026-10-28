"""Verify local routing uses the production handlers without external calls."""

import importlib

from backend.dev_server import app


def test_local_health_does_not_need_credentials(monkeypatch):
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    response = app.test_client().get("/api/optimizer/health")
    assert response.status_code == 200
    assert response.json == {"ok": True, "runtime": "python"}


def test_local_run_uses_existing_optimizer_handler(monkeypatch):
    handler = importlib.import_module("api.optimizer.run")
    client = object()
    monkeypatch.setattr(handler, "SupabaseClient", lambda: client)

    def run(supabase, *, ledger_id):
        assert supabase is client
        assert ledger_id == 42
        return {"inspected": 1}

    monkeypatch.setattr(handler, "run_optimizer_batch", run)
    response = app.test_client().post("/api/optimizer/run", json={"ledgerId": 42})
    assert response.status_code == 200
    assert response.json == {"inspected": 1}


def test_local_run_rejects_invalid_ledger_before_external_calls(monkeypatch):
    handler = importlib.import_module("api.optimizer.run")

    def unexpected_client():
        raise AssertionError("Invalid requests must not connect to Supabase")

    monkeypatch.setattr(handler, "SupabaseClient", unexpected_client)
    response = app.test_client().post("/api/optimizer/run", json={"ledgerId": -1})
    assert response.status_code == 400
    assert "positive integer" in response.json["error"]
