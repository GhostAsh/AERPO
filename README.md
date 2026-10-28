# AERPO

AERPO is a protocol-bound ERP optimization command center. It combines a
Next.js operations dashboard, Python orchestration, Supabase persistence and
Realtime, and Nebius-hosted AI inference to review financial ledger records
without granting the model unrestricted database access.

## What It Does

- Streams ERP ledger rows and agent telemetry from Supabase.
- Lets operators create ledgers and request an immediate agent review.
- Constrains model output to a strict, validated Pydantic contract.
- Records hypotheses, falsification tests, evidence needs, and confidence.
- Routes proposed corrections through a human approval workflow.
- Supports approve, reject, and request-evidence decisions.
- Allows approved correction proposals to be edited before execution.
- Applies only allowlisted ledger updates and preserves an audit trail.

The agent may propose work, but Python validation and human decisions determine
what can reach the ledger.

## Architecture

```text
Browser
  -> Next.js dashboard
  -> Next.js server routes (/internal-api/*)
  -> Vercel Python functions (/api/optimizer/*)
  -> constrained orchestration and validation
  -> Nebius inference + Supabase persistence
```

Primary application areas:

- **Scorecard:** exposure, queue metrics, department totals, and live telemetry.
- **Ledger Review:** ledger creation, human actions, agent review, and details.
- **Telemetry:** protocol decisions and confidence across agent activity.
- **Corrections:** evidence, proposed changes, editing, approval, and execution.
- **Approvals:** completed human review decisions and their outcomes.

## Protocol Boundary

The model receives a narrow request containing one ledger record, permitted
actions, permitted database operations, and an explicit response contract. The
backend then enforces the following controls:

1. Model output must be valid JSON matching `OptimizationResponse`.
2. The returned ledger ID must match the inspected ledger.
3. Agent-authored database changes are limited to allowlisted status values.
4. Correction proposals must change the current value and include evidence.
5. Human approval, rejection, and evidence requests constrain the next action.
6. Invalid JSON, schema, or semantic output gets one constrained retry, then fails.
   Truncated JSON receives a larger output budget on that retry.
7. Deployed application roles have no table-level `DELETE` permission.

The model never receives arbitrary SQL execution capability.

## Runtime

The deployed Vercel project uses two server runtimes:

- `/internal-api/*` uses Next.js route handlers for ledger creation, prompts,
  human actions, correction review, and correction execution.
- `/api/optimizer/run` uses `api/optimizer/run.py` for the Python optimizer.
- `/api/optimizer/health` uses `api/optimizer/health.py` as a non-mutating
  runtime check.
- During development, optimizer requests proxy to `http://127.0.0.1:8000`.
  `npm run dev` starts both runtimes. Set `OPTIMIZER_DEV_ORIGIN` only when
  intentionally using a separately managed optimizer service.

Vercel installs Python dependencies from `requirements.txt`, reads the runtime
version from `.python-version`, and applies limits from `vercel.json`.

## Environment

Create `.env.local` from `.env.example` and provide:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEBIUS_API_KEY
NEBIUS_BASE_URL
NEBIUS_MODEL
```

Legacy Supabase names `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are also supported. Never expose the Supabase secret
or Nebius API key through a `NEXT_PUBLIC_` variable.

## Local Development

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run dev
```

`npm run dev` starts the Python optimizer on loopback port 8000, waits for it
to bind successfully, then starts Next.js. Ctrl+C stops both. The launcher uses
`.venv` when present, otherwise `python` on PATH; set `PYTHON` to an interpreter
path to override this. On macOS/Linux, install dependencies with
`.venv/bin/python -m pip install -r requirements.txt` instead.

Check `http://localhost:3000/api/optimizer/health` for
`{"ok":true,"runtime":"python"}`. This check does not call Supabase or Nebius.
Local optimizer runs still use the Supabase and Nebius credentials in
`.env.local`, so reviews write to that configured database.

The development rewrite timeout is ten minutes to accommodate multi-ledger
inference and retries. Production Vercel limits are unchanged. Requests are not
automatically retried, since a disconnected run may already have written data.

For separate terminals, run `npm run dev:optimizer` and `npm run dev:web`
(activate your Python environment first). If port 8000 is occupied, stop the
conflicting process or run an optimizer separately and set
`OPTIMIZER_DEV_ORIGIN` to its origin. The launcher does not start a local
optimizer when that override is set. Use `vercel dev` to test Vercel routing;
its Python functions are managed by Vercel rather than this launcher.

## Validation

```powershell
npm run typecheck
npm run build
npm run test:backend
```

The backend tests cover model contracts, protocol retries, idempotent correction
creation, and allowlisted Supabase writes.

## Database Setup

Run the SQL files in `docs/sql` in date order. They create prompt events,
correction proposals, ledger idempotency controls, correction editing support,
and the production access policies used by Vercel.

The browser uses the publishable Supabase key for RLS-limited reads and Realtime.
All writes pass through server-side routes using the server-only Supabase key.

## Deployment

The production deployment is available at [aerpo.vercel.app](https://aerpo.vercel.app/).
Vercel deploys changes pushed to `main`.

Before presenting a release, follow
[`docs/MVP-RELEASE-CHECKLIST.md`](docs/MVP-RELEASE-CHECKLIST.md).
