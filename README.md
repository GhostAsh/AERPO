# AERPO

AERPO is an ERP optimization command center. The project combines a Next.js
executive dashboard, a Python orchestration backend, Supabase persistence, and a
strictly constrained AI inference layer for structured ledger review.

The core idea is simple: the model is not allowed to behave like a general chat
LLM. It is treated as a structured inference engine that emits Python-friendly
data shapes only. Python owns orchestration, validation, scoring, logging, and
database mutation safety.

## Current Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- Backend orchestration: Python
- Database and realtime layer: Supabase
- AI provider target: Nebius AI Cloud
- Model target: Nemotron-70B through an OpenAI-compatible API endpoint
- Package manager: npm

## Project Shape

```text
backend/
  nebius_client.py
  orchestration.py
  schemas.py
  supabase_client.py
  test_nebius_contract.py
  test_supabase_safe_write.py

src/
  app/
    globals.css
    layout.tsx
    page.tsx
```

## Frontend Command Center

The frontend is an executive dashboard for ERP optimization workflows. It is
built to show:

- Ledger exposure and review queue metrics
- Approval status for ERP ledger rows
- Department-level financial exposure
- Live logic-tree telemetry
- Human review, approval, and rollback surfaces

The dashboard is currently using static sample data shaped around the planned
Supabase tables. The next step is to replace the sample data with Supabase reads
and Realtime subscriptions.

## Supabase Backend

Supabase is the project data layer. It will store ledger records, model
telemetry, human review decisions, and correction history.

Primary tables:

- `erp_ledger`
  - Stores ERP transaction rows.
  - Tracks amount, department, status, and optimization notes.
  - Acts as the main worklist for review and approval.

- `agent_telemetry`
  - Stores each structured reasoning step linked to a ledger row.
  - Captures hypothesis, falsification test, confidence score, and executed
    step.
  - Provides the audit trail shown in the command center.

Supabase Realtime will stream ledger updates and telemetry events to the UI so
operators can watch correction paths and review queues change live.

## Python Backend

Python is the system brain. The model proposes structured candidates, but Python
decides what is valid, what is logged, and what is safe to present for review.

Planned responsibilities:

- Query Nebius through an OpenAI-compatible endpoint.
- Build strict model requests with explicit data keys.
- Validate every model response against schemas before use.
- Reject freeform natural language where structured output is required.
- Run deterministic parsing and scoring.
- Write telemetry steps to Supabase.
- Create correction candidates for human approval.
- Prevent direct destructive ledger mutation without approval.

## Structured AI Protocol

Nemotron-70B is intentionally constrained into an ML-style role. The model must
not return generic assistant prose for backend workflows. It must return clean
JSON-compatible structures that Python can parse deterministically.

Expected response shape:

```json
{
  "hypothesis_generation": [],
  "falsification_testing": [],
  "state_weights": {},
  "required_evidence": [],
  "proposed_action": {},
  "confidence_score": 0.0
}
```

Protocol rules:

- Output must be valid JSON or Python-compatible primitives.
- No conversational filler.
- No markdown for machine-consumed responses.
- No unstructured recommendations.
- Every proposed correction must include evidence and a falsification path.
- Confidence must be numeric and bounded.
- Invalid schema output is rejected or retried.
- Database writes are never trusted solely because the model suggested them.

## ERP Optimization Process

The intended data optimization loop:

1. Load candidate ledger records from Supabase.
2. Normalize each record into a deterministic Python payload.
3. Ask the model for structured hypotheses and falsification tests.
4. Validate the response schema.
5. Score confidence and evidence quality.
6. Log each step to `agent_telemetry`.
7. Create a correction candidate if the result passes validation.
8. Present the candidate in the dashboard.
9. Require human approval before applying ledger changes.
10. Preserve rollback metadata for audit safety.

## Safety Model

AERPO is designed around human-in-the-loop controls.

- The AI can suggest corrections.
- Python validates and logs those suggestions.
- Supabase stores the audit trail.
- The dashboard exposes review and approval controls.
- Humans approve, reject, or roll back ledger changes.

The model should never silently mutate financial records.

## Environment

Credentials are expected to live in local environment files such as
`.env.local`. These files are ignored by Git and should not be committed.

Expected credential categories:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEBIUS_API_KEY`
- `NEBIUS_BASE_URL`, optional override for the OpenAI-compatible endpoint
- `NEBIUS_MODEL`, optional override for the target Nemotron model

## Current Status

- Next.js app created.
- Tailwind CSS installed and configured.
- Command center dashboard shell started.
- Python backend folder scaffolded.
- Supabase table plan identified.
- Nebius model integration pending token approval.
