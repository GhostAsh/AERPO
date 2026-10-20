-- AERPO schema handoff
-- Purpose:
--   Make ledger creation idempotent across retries, application restarts, and
--   multiple server instances.
--
-- Why this fix:
--   An in-memory request map only protects one running Next.js process. This
--   migration records each creation key in Supabase and performs the request
--   claim, ledger insert, and request completion in one database transaction.
--
-- Safety model:
--   - Only service_role may execute the creation function.
--   - New ledgers always begin with pending status.
--   - Replaying the same key and payload returns the original ledger.
--   - Reusing a key with a different payload is blocked.
--   - The journal retains its ledger reference and cannot cascade-delete it.
--
-- Run order:
--   1. Run preflight diagnostics.
--   2. Run the migration body as a database owner in Supabase SQL Editor.
--   3. Run verification queries.

-- ---------------------------------------------------------------------------
-- Preflight diagnostics
-- ---------------------------------------------------------------------------

select
  to_regclass('public.erp_ledger') as erp_ledger_table,
  to_regclass('public.ledger_creation_requests') as creation_requests_table;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'erp_ledger'
  and column_name in (
    'id',
    'amount',
    'department',
    'description',
    'optimization_notes',
    'status',
    'transaction_date'
  )
order by column_name;

-- ---------------------------------------------------------------------------
-- Migration body
-- ---------------------------------------------------------------------------

create table if not exists public.ledger_creation_requests (
  idempotency_key text primary key,
  request_hash text not null,
  ledger_id bigint unique references public.erp_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint ledger_creation_key_format_check
    check (
      idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    ),
  constraint ledger_creation_hash_format_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ledger_creation_completion_check
    check (
      (ledger_id is null and completed_at is null)
      or (ledger_id is not null and completed_at is not null)
    )
);

create index if not exists ledger_creation_created_idx
  on public.ledger_creation_requests (created_at desc);

create or replace function public.create_ledger_idempotently(
  p_idempotency_key text,
  p_request_hash text,
  p_amount numeric,
  p_department text,
  p_description text,
  p_optimization_notes text,
  p_transaction_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  creation_request public.ledger_creation_requests%rowtype;
  ledger public.erp_ledger%rowtype;
begin
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_IDEMPOTENCY_KEY',
      'message', 'A valid idempotency key is required.'
    );
  end if;

  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_REQUEST_HASH',
      'message', 'A valid request fingerprint is required.'
    );
  end if;

  if p_amount is null or p_amount = 0
     or nullif(btrim(p_department), '') is null
     or char_length(btrim(p_department)) > 80
     or nullif(btrim(p_description), '') is null
     or char_length(btrim(p_description)) > 240
     or char_length(coalesce(p_optimization_notes, '')) > 500
     or p_transaction_date is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_LEDGER_INPUT',
      'message', 'Ledger input failed the database creation protocol.'
    );
  end if;

  insert into public.ledger_creation_requests (
    idempotency_key,
    request_hash
  ) values (
    p_idempotency_key,
    p_request_hash
  )
  on conflict (idempotency_key) do nothing;

  select *
  into creation_request
  from public.ledger_creation_requests
  where idempotency_key = p_idempotency_key
  for update;

  if creation_request.request_hash is distinct from p_request_hash then
    return jsonb_build_object(
      'ok', false,
      'code', 'IDEMPOTENCY_CONFLICT',
      'message', 'This creation key was already used for different ledger data.'
    );
  end if;

  if creation_request.ledger_id is not null then
    select *
    into ledger
    from public.erp_ledger
    where id = creation_request.ledger_id;

    return jsonb_build_object(
      'ok', true,
      'code', 'LEDGER_REPLAYED',
      'replayed', true,
      'ledger', to_jsonb(ledger)
    );
  end if;

  insert into public.erp_ledger (
    amount,
    department,
    description,
    optimization_notes,
    status,
    transaction_date
  ) values (
    p_amount,
    btrim(p_department),
    btrim(p_description),
    nullif(btrim(p_optimization_notes), ''),
    'pending',
    p_transaction_date
  )
  returning * into ledger;

  update public.ledger_creation_requests
  set
    ledger_id = ledger.id,
    completed_at = now()
  where idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'ok', true,
    'code', 'LEDGER_CREATED',
    'replayed', false,
    'ledger', to_jsonb(ledger)
  );
end;
$$;

alter table public.ledger_creation_requests enable row level security;

grant usage on schema public to service_role;
grant select on public.ledger_creation_requests to service_role;

revoke all on public.ledger_creation_requests from anon;
revoke all on public.ledger_creation_requests from authenticated;

revoke all on function public.create_ledger_idempotently(
  text,
  text,
  numeric,
  text,
  text,
  text,
  date
) from public;
revoke all on function public.create_ledger_idempotently(
  text,
  text,
  numeric,
  text,
  text,
  text,
  date
) from anon;
revoke all on function public.create_ledger_idempotently(
  text,
  text,
  numeric,
  text,
  text,
  text,
  date
) from authenticated;
grant execute on function public.create_ledger_idempotently(
  text,
  text,
  numeric,
  text,
  text,
  text,
  date
) to service_role;

comment on table public.ledger_creation_requests is
  'Durable idempotency journal for server-side ERP ledger creation.';

comment on function public.create_ledger_idempotently(
  text,
  text,
  numeric,
  text,
  text,
  text,
  date
) is
  'Atomically creates one pending ledger per idempotency key and request hash.';

-- Ask PostgREST to refresh its schema after this migration.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification queries
-- ---------------------------------------------------------------------------

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ledger_creation_requests'
order by ordinal_position;

select conname, contype
from pg_constraint
where conrelid = 'public.ledger_creation_requests'::regclass
order by conname;

select
  has_table_privilege(
    'service_role',
    'public.ledger_creation_requests',
    'select'
  ) as service_role_can_read_creation_journal,
  has_function_privilege(
    'service_role',
    'public.create_ledger_idempotently(text,text,numeric,text,text,text,date)',
    'execute'
  ) as service_role_can_create_ledger,
  has_function_privilege(
    'anon',
    'public.create_ledger_idempotently(text,text,numeric,text,text,text,date)',
    'execute'
  ) as anon_can_create_ledger,
  has_function_privilege(
    'authenticated',
    'public.create_ledger_idempotently(text,text,numeric,text,text,text,date)',
    'execute'
  ) as authenticated_can_create_ledger;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'ledger_creation_requests';

-- Expected:
--   service_role_can_read_creation_journal = true
--   service_role_can_create_ledger = true
--   anon_can_create_ledger = false
--   authenticated_can_create_ledger = false
--   rowsecurity = true

-- Optional post-deployment journal check (zero rows is valid before use):
select idempotency_key, ledger_id, created_at, completed_at
from public.ledger_creation_requests
order by created_at desc
limit 10;

-- ---------------------------------------------------------------------------
-- Rollback guidance
-- ---------------------------------------------------------------------------
-- WARNING: dropping the journal removes replay protection for prior requests.
-- drop function if exists public.create_ledger_idempotently(
--   text, text, numeric, text, text, text, date
-- );
-- drop table if exists public.ledger_creation_requests;
