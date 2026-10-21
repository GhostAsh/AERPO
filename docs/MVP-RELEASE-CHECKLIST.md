# MVP Release Checklist

## Automated Checks

- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run test:backend` passes.
- [ ] The Vercel production deployment is built from the latest `main` commit.

## Configuration

- [ ] Production and Preview contain all variables from `.env.example`.
- [ ] Supabase and Nebius secrets are server-only and never use `NEXT_PUBLIC_`.
- [ ] Every dated migration in `docs/sql` has been applied in order.
- [ ] Supabase Realtime includes the ledger and telemetry tables used by the UI.

## Non-Mutating Smoke Checks

- [ ] `/` redirects to `/dashboard`.
- [ ] `/api/optimizer/health` returns HTTP 200 and JSON containing `ok: true`.
- [ ] Scorecard, Ledger Review, Telemetry, Corrections, and Approvals load.
- [ ] Browser and Vercel logs contain no credential or stack-trace exposure.

## Controlled Workflow

Use a clearly labeled test ledger with a small amount.

- [ ] Create the ledger with a unique idempotency request.
- [ ] Run agent review and confirm a visible thinking state.
- [ ] Confirm telemetry appears without a manual refresh.
- [ ] Request evidence and confirm evidence is attached to the ledger workflow.
- [ ] Approve or reject the human review and confirm the action persists.
- [ ] Edit a correction proposal before approval.
- [ ] Approve and apply the correction once.
- [ ] Confirm the ledger updates and the finalized controls become disabled.
- [ ] Repeat the action and confirm no duplicate correction or mutation occurs.

## Demo Reset

- [ ] Remove or clearly label test records before judging.
- [ ] Leave representative pending, review, approved, and duplicate examples.
- [ ] Confirm the dashboard totals match the visible ledger data.
- [ ] Keep one correction ready for review and one completed audit trail.
