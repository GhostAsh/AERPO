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
6. Invalid schema or semantic output gets one constrained retry, then fails.
7. Deployed application roles have no table-level `DELETE` permission.

The model never receives arbitrary SQL execution capability.

## Runtime

The deployed Vercel project uses two server runtimes:

- `/internal-api/*` uses Next.js route handlers for ledger creation, prompts,
  human actions, correction review, and correction execution.
- `/api/optimizer/run` uses `api/optimizer/run.py` for the Python optimizer.
- `/api/optimizer/health` uses `api/optimizer/health.py` as a non-mutating
  runtime check.
- During `next dev`, optimizer requests proxy to the deployed Python service at
  `https://aerpo.vercel.app`. Set `OPTIMIZER_DEV_ORIGIN` to use another origin.

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
npm run dev
```

`npm run dev` serves the Next.js application. Use `vercel dev` when testing the
Next.js and Python routes together locally.

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
