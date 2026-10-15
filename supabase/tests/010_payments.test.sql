-- P2e1: record_payment(), cancel_devis(), and the triggers that bind every role:
-- DF018 (no overpayment), DF019 ('paid' only when covered), DF021 (no cancel after a
-- conversion), 'paid' set automatically. Design: docs/p2e-design.md.
begin;
select * from no_plan();

select tests.seed();

-- Fixtures (as superuser). mark_sent documents have one line: net à payer 100.000.
-- Numbers from 901 so that finalize_document() below can take number 1 of its series.
select tests.create_draft('f_pay', tests.id('org_a'), tests.id('client_a'));
select tests.mark_sent(tests.id('f_pay'), 901);
select tests.create_draft('f_draft', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('f_super', tests.id('org_a'), tests.id('client_a'));
select tests.mark_sent(tests.id('f_super'), 902);
select tests.create_draft('d_sent', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('d_sent'), 901);
select tests.create_draft('d_draft', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.create_draft('d_cancel', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('d_cancel'), 902);
select tests.create_draft('d_converted', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('d_converted'), 903);
select tests.create_draft('f_from_devis', tests.id('org_a'), tests.id('client_a'));
update public.documents set converted_from = tests.id('d_converted') where id = tests.id('f_from_devis');
select tests.create_draft('b_fac', tests.id('org_b'), tests.id('client_b'));
select tests.mark_sent(tests.id('b_fac'), 901);
select tests.create_draft('b_devis', tests.id('org_b'), tests.id('client_b'), 'devis');
select tests.mark_sent(tests.id('b_devis'), 901);

-- A facture with a timbre of 1.000, issued for real: net à payer 101.000.
update public.tax_settings set timbre_enabled = true, timbre_fiscal = 1.000 where organization_id = tests.id('org_a');
select tests.create_draft('f_timbre', tests.id('org_a'), tests.id('client_a'));
select tests.finalize_as('alice@test.local', tests.id('f_timbre'), '101.000');

-- 1. PRIVILEGES -------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.payments', 'INSERT'), 'authenticated has no INSERT on payments');
select is_empty(
  $$ select column_name::text from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'payments' and grantee = 'authenticated' and privilege_type = 'INSERT' $$,
  'authenticated has no column INSERT on payments either');
select is_empty(
  $$ select policyname::text from pg_policies where schemaname = 'public' and tablename = 'payments' and cmd = 'INSERT' $$,
  'payments has no INSERT policy');
select is_empty(
  $$ select f.name, r.rolname
     from (values ('public.record_payment(uuid, text, date, public.payment_method)'), ('public.cancel_devis(uuid)')) f (name)
     cross join (values ('anon'), ('service_role')) r (rolname)
     where has_function_privilege(r.rolname, f.name::regprocedure, 'EXECUTE') $$,
  'neither anon nor service_role can execute record_payment or cancel_devis');
select ok(
  has_function_privilege('authenticated', 'public.record_payment(uuid, text, date, public.payment_method)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_devis(uuid)', 'EXECUTE'),
  'authenticated can execute both');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('cancel_devis', 'record_payment')
     and p.prosecdef and p.proconfig = array['search_path=""']),
  2, 'both are SECURITY DEFINER with an empty search_path');

-- 2. record_payment: refusals, in order -------------------------------------------------
select throws_ok(
  $$ select public.record_payment(tests.id('f_pay'), '10.000', current_date, 'cash') $$,
  'DF000', null, 'no user id: DF000');

select tests.authenticate_as('alice@test.local');
select throws_ok($$ select public.record_payment(gen_random_uuid(), '10.000', current_date, 'cash') $$, 'DF001', null, 'unknown document: DF001');
select throws_ok($$ select public.record_payment(tests.id('b_fac'), '10.000', current_date, 'cash') $$, 'DF001', null, 'another organization''s sent facture: DF001, like an unknown id');
select throws_ok($$ select public.record_payment(tests.id('f_draft'), '10.000', current_date, 'cash') $$, 'DF016', null, 'draft facture: DF016');
select throws_ok($$ select public.record_payment(tests.id('d_sent'), '10.000', current_date, 'cash') $$, 'DF016', null, 'sent devis: DF016');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '250', current_date, 'cash') $$, 'DF024', null, 'amount "250" (no decimals): DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '1e3', current_date, 'cash') $$, 'DF024', null, 'amount "1e3": DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '2,500', current_date, 'cash') $$, 'DF024', null, 'amount "2,500" (comma): DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), ' 1.000', current_date, 'cash') $$, 'DF024', null, 'amount with a space: DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '-1.000', current_date, 'cash') $$, 'DF024', null, 'negative amount: DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '1.0000', current_date, 'cash') $$, 'DF024', null, 'four decimals: DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '0.000', current_date, 'cash') $$, 'DF024', null, 'zero: DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), null, current_date, 'cash') $$, 'DF024', null, 'NULL amount: DF024');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '1.000', null, 'cash') $$, '23502', null, 'NULL date: 23502');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '100.001', current_date, 'cash') $$, 'DF018', null, 'more than the net à payer: DF018');

-- 3. record_payment: partial, then exact -----------------------------------------------
select is(
  (select row(p.organization_id, p.document_id, p.amount, p.method)::text
   from public.record_payment(tests.id('f_pay'), '40.000', current_date, 'virement') p),
  row(tests.id('org_a'), tests.id('f_pay'), 40.000::numeric(12, 3), 'virement'::public.payment_method)::text,
  'a partial payment is recorded and returned, in the document''s organization');
select is((select status::text from public.documents where id = tests.id('f_pay')), 'sent', 'a partial payment leaves the facture sent');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '60.001', current_date, 'cash') $$, 'DF018', null, 'one millime over the remaining 60.000: DF018');
select lives_ok($$ select public.record_payment(tests.id('f_pay'), '60.000', current_date, 'cheque') $$, 'the exact remaining amount is accepted');
select is((select status::text from public.documents where id = tests.id('f_pay')), 'paid', 'and the facture is paid, by itself');
select is((select sum(amount) from public.payments where document_id = tests.id('f_pay')), 100.000::numeric, 'the payments equal the net à payer');
select throws_ok($$ select public.record_payment(tests.id('f_pay'), '1.000', current_date, 'cash') $$, 'DF016', null, 'a paid facture takes no more payment: DF016');

-- The timbre is owed too: covering the TTC is not enough.
select lives_ok($$ select public.record_payment(tests.id('f_timbre'), '100.000', current_date, 'cash') $$, 'timbre facture: 100.000 of 101.000');
select is((select status::text from public.documents where id = tests.id('f_timbre')), 'sent', 'covering the TTC without the timbre does not pay the facture');
select lives_ok($$ select public.record_payment(tests.id('f_timbre'), '1.000', current_date, 'cash') $$, 'the timbre is paid');
select is((select status::text from public.documents where id = tests.id('f_timbre')), 'paid', 'now it is paid');

-- The API role still cannot write a status by hand.
select throws_ok($$ update public.documents set status = 'paid' where id = tests.id('f_super') $$, '42501', null, 'the API role cannot set paid by hand');
select tests.clear_auth();

select tests.authenticate_as('bob@test.local');
select is_empty($$ select 1 from public.payments where organization_id = tests.id('org_a') $$, 'B reads none of A''s payments');
select tests.clear_auth();

-- 4. Every role: DF018, DF019, automatic paid -------------------------------------------
insert into public.payments (organization_id, document_id, amount, paid_at, method)
values (tests.id('org_a'), tests.id('f_super'), 30.000, current_date, 'cash');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('f_super'), 70.001, current_date, 'cash') $$,
  'DF018', null, 'superuser: overpayment refused too');
select throws_ok(
  $$ update public.documents set status = 'paid' where id = tests.id('f_super') $$,
  'DF019', null, 'superuser: paid by hand while 70.000 is still owed: DF019');
select lives_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('f_super'), 70.000, current_date, 'cash') $$,
  'superuser: the remaining 70.000 is accepted');
select is((select status::text from public.documents where id = tests.id('f_super')), 'paid', 'superuser: the facture is paid by the trigger as well');

-- 5. cancel_devis -----------------------------------------------------------------------
select throws_ok($$ select public.cancel_devis(tests.id('d_cancel')) $$, 'DF000', null, 'cancel_devis without a user id: DF000');

select tests.authenticate_as('alice@test.local');
select throws_ok($$ select public.cancel_devis(gen_random_uuid()) $$, 'DF001', null, 'unknown devis: DF001');
select throws_ok($$ select public.cancel_devis(tests.id('b_devis')) $$, 'DF001', null, 'another organization''s devis: DF001');
select throws_ok($$ select public.cancel_devis(tests.id('f_super')) $$, 'DF012', null, 'a facture cannot be cancelled: DF012');
select throws_ok($$ select public.cancel_devis(tests.id('d_draft')) $$, 'DF012', null, 'a draft devis cannot be cancelled: DF012');
select throws_ok($$ select public.cancel_devis(tests.id('d_converted')) $$, 'DF021', null, 'a devis with a converted facture cannot be cancelled: DF021');
select is(
  (select status::text from public.cancel_devis(tests.id('d_cancel'))),
  'cancelled', 'a sent devis is cancelled and returned');
select throws_ok($$ select public.cancel_devis(tests.id('d_cancel')) $$, 'DF012', null, 'cancelling it again: DF012');
select tests.clear_auth();

select is((select status::text from public.documents where id = tests.id('d_converted')), 'sent', 'the converted devis is still sent');
select is((select status::text from public.documents where id = tests.id('b_devis')), 'sent', 'B''s devis was not touched');
select throws_ok(
  $$ update public.documents set status = 'cancelled' where id = tests.id('d_converted') $$,
  'DF021', null, 'superuser: DF021 too');

select * from finish();
rollback;
