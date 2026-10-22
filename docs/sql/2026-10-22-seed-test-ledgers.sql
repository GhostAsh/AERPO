-- AERPO fake ledger data: six pending records for manual workflow testing.
-- Run this entire file as the database owner in Supabase SQL Editor.
-- Prerequisite: 2026-10-17-create-ledger-idempotency.sql has been applied.
-- Uses fixed keys: reruns return existing records without resetting their state.
-- No schema, grants, existing ledger values, or document records are changed.
-- These rows affect dashboard totals. All descriptions begin with [TEST].

-- Preflight: both values should be non-null.
select
  to_regclass('public.erp_ledger') as ledger_table,
  to_regprocedure(
    'public.create_ledger_idempotently(text,text,numeric,text,text,text,date)'
  ) as creation_function;

begin;

do $$
declare
  sample record;
  payload jsonb;
  result jsonb;
begin
  for sample in
    select * from (values
      ('routine', 125.00::numeric, 'Operations',
       '[TEST] Routine office supplies - DEMO-INV-1001',
       'Synthetic test data. Routine purchase; attach a matching invoice for evidence testing.'),
      ('duplicate-a', 240.00::numeric, 'IT',
       '[TEST] Software subscription - DEMO-INV-1002 - entry A',
       'Synthetic test data. Same invoice reference and amount as entry B; investigate a possible duplicate.'),
      ('duplicate-b', 240.00::numeric, 'IT',
       '[TEST] Software subscription - DEMO-INV-1002 - entry B',
       'Synthetic test data. Same invoice reference and amount as entry A; investigate a possible duplicate.'),
      ('mismatch', 375.00::numeric, 'Marketing',
       '[TEST] Print order - DEMO-INV-1003 - amount discrepancy',
       'Synthetic test data. Ledger amount is 375.00; prepare an invoice totaling 325.00 to test discrepancy review.'),
      ('missing-evidence', 89.50::numeric, 'Operations',
       '[TEST] Courier charge - DEMO-INV-1004 - missing receipt',
       'Synthetic test data. No receipt supplied; use this record to test requesting evidence.'),
      ('credit', -45.00::numeric, 'Finance',
       '[TEST] Vendor credit - DEMO-CN-1005',
       'Synthetic test data. Negative amount represents a vendor credit; attach a credit note for review.')
    ) as samples(test_key, amount, department, description, notes)
  loop
    payload := jsonb_build_object(
      'amount', sample.amount,
      'department', sample.department,
      'description', sample.description,
      'notes', sample.notes,
      'date', '2026-10-22'
    );

    result := public.create_ledger_idempotently(
      'aerpo-test-20261022-v1-' || sample.test_key,
      encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'),
      sample.amount, sample.department, sample.description, sample.notes,
      date '2026-10-22'
    );

    if (result ->> 'ok')::boolean is distinct from true then
      raise exception 'Test seed failed for %: %', sample.test_key, result;
    end if;
  end loop;
end;
$$;

commit;

-- Verification: expect six rows. All start pending on the first run.
-- Reruns preserve any subsequent review decisions and corrections.
select ledger.id, ledger.transaction_date, ledger.description,
       ledger.amount, ledger.department, ledger.status
from public.ledger_creation_requests as request
join public.erp_ledger as ledger on ledger.id = request.ledger_id
where request.idempotency_key like 'aerpo-test-20261022-v1-%'
order by ledger.id;

-- Upload real test TXT, CSV, or PDF files through Ledger Review to exercise
-- document extraction/readiness. This script does not simulate attachments,
-- agent outcomes, telemetry, approvals, or correction execution.
