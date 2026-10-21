-- AERPO schema handoff
-- Purpose:
--   Harden the unauthenticated Vercel deployment around the app's real access
--   pattern: public read/Realtime visibility, constrained server-side creates
--   and updates, and no DELETE permission for deployed application roles.
--
-- Identity boundary:
--   The public app has no user authentication, so the database cannot tell the
--   project owner apart from a judge using the UI. DELETE is therefore denied
--   to anon, authenticated, and service_role. The database owner may still
--   perform intentional maintenance in the Supabase SQL editor.
--
-- Run order:
--   1. Run the preflight queries and confirm every expected table exists.
--   2. Run the migration body as the database owner in Supabase SQL Editor.
--   3. Run the verification queries.

-- ---------------------------------------------------------------------------
-- Preflight diagnostics
-- ---------------------------------------------------------------------------

select
  to_regclass('public.erp_ledger') as erp_ledger,
  to_regclass('public.agent_telemetry') as agent_telemetry,
  to_regclass('public.ledger_agent_prompt_events') as prompt_events,
  to_regclass('public.ledger_correction_proposals') as correction_proposals,
  to_regclass('public.ledger_correction_proposal_edits') as correction_edits,
  to_regclass('public.ledger_creation_requests') as creation_requests;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'erp_ledger',
    'agent_telemetry',
    'ledger_agent_prompt_events',
    'ledger_correction_proposals',
    'ledger_correction_proposal_edits',
    'ledger_creation_requests'
  )
order by tablename;

-- ---------------------------------------------------------------------------
-- Migration body
-- ---------------------------------------------------------------------------

begin;

alter table public.erp_ledger enable row level security;
alter table public.agent_telemetry enable row level security;
alter table public.ledger_agent_prompt_events enable row level security;
alter table public.ledger_correction_proposals enable row level security;
alter table public.ledger_correction_proposal_edits enable row level security;
alter table public.ledger_creation_requests enable row level security;

-- Clear table capabilities first. Policies cannot restore a revoked grant.
revoke all on table public.erp_ledger from public, anon, authenticated;
revoke all on table public.agent_telemetry from public, anon, authenticated;
revoke all on table public.ledger_agent_prompt_events from public, anon, authenticated;
revoke all on table public.ledger_correction_proposals from public, anon, authenticated;
revoke all on table public.ledger_correction_proposal_edits from public, anon, authenticated;
revoke all on table public.ledger_creation_requests from public, anon, authenticated;

-- Reset the deployed server to an exact capability list below. This also
-- removes DELETE and any broader historical grants.
revoke all on table public.erp_ledger from service_role;
revoke all on table public.agent_telemetry from service_role;
revoke all on table public.ledger_agent_prompt_events from service_role;
revoke all on table public.ledger_correction_proposals from service_role;
revoke all on table public.ledger_correction_proposal_edits from service_role;
revoke all on table public.ledger_creation_requests from service_role;

grant usage on schema public to anon, service_role;

-- Browser reads required by dashboard views and Postgres Changes subscriptions.
grant select on table public.erp_ledger to anon;
grant select on table public.agent_telemetry to anon;
grant select on table public.ledger_agent_prompt_events to anon;
grant select on table public.ledger_correction_proposals to anon;

-- Server route and optimizer capabilities.
grant select, update on table public.erp_ledger to service_role;
grant select, insert on table public.agent_telemetry to service_role;
grant select, insert, update on table public.ledger_agent_prompt_events to service_role;
grant select, insert on table public.ledger_correction_proposals to service_role;
grant select on table public.ledger_correction_proposal_edits to service_role;

-- ledger_creation_requests is private implementation state. The owner-run
-- create_ledger_idempotently SECURITY DEFINER function accesses it internally.

-- Replace only AERPO-owned public read policies. Existing unrelated policies
-- are left intact, while revoked write grants prevent them from enabling writes.
drop policy if exists aerpo_public_read_erp_ledger on public.erp_ledger;
create policy aerpo_public_read_erp_ledger
  on public.erp_ledger for select to anon using (true);

drop policy if exists aerpo_public_read_agent_telemetry on public.agent_telemetry;
create policy aerpo_public_read_agent_telemetry
  on public.agent_telemetry for select to anon using (true);

drop policy if exists aerpo_public_read_prompt_events
  on public.ledger_agent_prompt_events;
create policy aerpo_public_read_prompt_events
  on public.ledger_agent_prompt_events for select to anon using (true);

drop policy if exists aerpo_public_read_correction_proposals
  on public.ledger_correction_proposals;
create policy aerpo_public_read_correction_proposals
  on public.ledger_correction_proposals for select to anon using (true);

-- RPCs are server-only. Their internal protocol checks remain the final write
-- authority for ledger creation and correction review/edit/execution.
revoke all on function public.create_ledger_idempotently(
  text, text, numeric, text, text, text, date
) from public, anon, authenticated;
grant execute on function public.create_ledger_idempotently(
  text, text, numeric, text, text, text, date
) to service_role;

revoke all on function public.review_ledger_correction(
  bigint, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.review_ledger_correction(
  bigint, text, text, uuid
) to service_role;

revoke all on function public.edit_ledger_correction_proposal(
  bigint, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.edit_ledger_correction_proposal(
  bigint, text, text, uuid
) to service_role;

revoke all on function public.apply_ledger_correction(bigint)
  from public, anon, authenticated;
grant execute on function public.apply_ledger_correction(bigint)
  to service_role;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification queries
-- ---------------------------------------------------------------------------

select
  table_name,
  has_table_privilege('anon', format('public.%I', table_name), 'select')
    as anon_can_select,
  has_table_privilege('anon', format('public.%I', table_name), 'insert')
    as anon_can_insert,
  has_table_privilege('anon', format('public.%I', table_name), 'update')
    as anon_can_update,
  has_table_privilege('anon', format('public.%I', table_name), 'delete')
    as anon_can_delete,
  has_table_privilege('service_role', format('public.%I', table_name), 'delete')
    as service_role_can_delete
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'erp_ledger',
    'agent_telemetry',
    'ledger_agent_prompt_events',
    'ledger_correction_proposals',
    'ledger_correction_proposal_edits',
    'ledger_creation_requests'
  )
order by table_name;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and policyname like 'aerpo_public_read_%'
order by tablename;

select
  has_function_privilege(
    'anon',
    'public.apply_ledger_correction(bigint)',
    'execute'
  ) as anon_can_apply_correction,
  has_function_privilege(
    'service_role',
    'public.apply_ledger_correction(bigint)',
    'execute'
  ) as service_role_can_apply_correction;

-- Expected:
--   - anon_can_select = true only for erp_ledger, agent_telemetry,
--     ledger_agent_prompt_events, and ledger_correction_proposals.
--   - every anon_can_insert, anon_can_update, and anon_can_delete = false.
--   - every service_role_can_delete = false.
--   - four aerpo_public_read_* SELECT policies are present.
--   - anon_can_apply_correction = false.
--   - service_role_can_apply_correction = true.

-- ---------------------------------------------------------------------------
-- Rollback guidance
-- ---------------------------------------------------------------------------
-- To remove public dashboard reads, revoke SELECT from anon and drop the four
-- aerpo_public_read_* policies. Do not grant DELETE to service_role unless the
-- deployed application intentionally gains a reviewed deletion workflow.
-- Owner maintenance in Supabase SQL Editor does not require that grant.
