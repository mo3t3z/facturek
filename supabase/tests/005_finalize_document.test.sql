-- finalize_document(): numbering, validation, snapshots, and who may call it.
-- Real multi-connection concurrency is tested separately: npm run test:concurrency.
begin;
select * from no_plan();

select tests.seed();

-- Identity fields to snapshot.
update public.organizations set matricule_fiscal = 'MF-ORG-A', address = '1 rue A, Tunis' where id = tests.id('org_a');
update public.clients set matricule_fiscal = 'MF-CLIENT-A', address = '2 rue C, Sfax' where id = tests.id('client_a');
-- Arbitrary TEST values, not real tax rules. seed() already set timbre_fiscal = 9.999 on
-- both organizations, with timbre_enabled left at its default (false).
update public.tax_settings set retenue_enabled = true, retenue_rate = 1.5, retenue_threshold = 1000
where organization_id = tests.id('org_a');

-- Drafts without issue_date: they will be dated today.
select tests.create_draft('f1', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('f2', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('f3', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('d1', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.create_draft('fb1', tests.id('org_b'), tests.id('client_b'));
select tests.create_draft('b_target', tests.id('org_b'), tests.id('client_b'));
select tests.create_draft('api_draft', tests.id('org_a'), tests.id('client_a'));

-- Drafts dated in a fixed past year, so the date tests do not depend on today's date.
select tests.create_draft('p1', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('p2', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('p3', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('p4', tests.id('org_a'), tests.id('client_a'));
update public.documents set issue_date = date '2024-06-10' where id in (tests.id('p1'), tests.id('p3'));
update public.documents set issue_date = date '2024-06-09' where id = tests.id('p2');
update public.documents set issue_date = date '2024-06-11' where id = tests.id('p4');

-- Drafts that must be rejected.
select tests.create_draft('future', tests.id('org_a'), tests.id('client_a'));
update public.documents set issue_date = private.today_tunis() + 1 where id = tests.id('future');
select tests.create_draft('due_before', tests.id('org_a'), tests.id('client_a'));
update public.documents set due_date = private.today_tunis() - 1 where id = tests.id('due_before');
select tests.create_draft('no_client', tests.id('org_a'), null);
select tests.create_draft('no_items', tests.id('org_a'), tests.id('client_a'));
delete from public.document_items where document_id = tests.id('no_items');

-- Drafts for the timbre rule.
select tests.create_draft('t_off_null', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('t_on_null', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('dv_on_null', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.create_draft('t_on_amount', tests.id('org_a'), tests.id('client_a'));

-- 1. HAPPY PATH AND NUMBERING -------------------------------------------------------------
select is(tests.finalize_as('alice@test.local', tests.id('f1')), 1, 'the first facture of the year gets number 1');
select results_eq(
  $$ select status::text, number, year, issue_date from public.documents where id = tests.id('f1') $$,
  $$ select 'sent', 1, extract(year from private.today_tunis())::int, private.today_tunis() $$,
  'it is sent, and its year and issue_date are today in Africa/Tunis');
select is(private.today_tunis(), (now() at time zone 'Africa/Tunis')::date, 'today_tunis() is the current date in Africa/Tunis');
select is(tests.finalize_as('dave@test.local', tests.id('f2')), 2, 'the second facture gets 2 (a plain member may finalize)');
select is(tests.finalize_as('carol@test.local', tests.id('d1')), 1, 'devis have their own sequence (an admin may finalize)');
select is(tests.finalize_as('bob@test.local', tests.id('fb1')), 1, 'another organization has its own sequence');

select tests.authenticate_as('alice@test.local');
select results_eq(
  $$ select status::text, number, seller_name from public.finalize_document(tests.id('f3')) $$,
  $$ values ('sent', 3, 'Org A') $$,
  'finalize_document returns the updated row');
select tests.clear_auth();

-- 2. YEARS AND DATES ----------------------------------------------------------------------
select is(tests.finalize_as('alice@test.local', tests.id('p1')), 1, 'a document dated in another year starts that year''s sequence at 1');
select results_eq(
  $$ select year, issue_date from public.documents where id = tests.id('p1') $$,
  $$ values (2024, date '2024-06-10') $$,
  'an explicit past issue_date is kept, and the year comes from it');

select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ select public.finalize_document(tests.id('p2')) $$,
  'DF006', 'issue date is earlier than the previous document of the same series',
  'a date earlier than the previous number of the same series is rejected');
select tests.clear_auth();
select is(tests.finalize_as('alice@test.local', tests.id('p3')), 2, 'the same date as the previous number is accepted, and the rejected attempt consumed no number');
select is(tests.finalize_as('alice@test.local', tests.id('p4')), 3, 'a later date is accepted');

select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ select public.finalize_document(tests.id('future')) $$,
  'DF005', 'issue date is in the future', 'an issue_date in the future is rejected');
select throws_ok(
  $$ select public.finalize_document(tests.id('due_before')) $$,
  'DF008', 'due date is before the issue date', 'a due_date before the issue date is rejected');
select tests.clear_auth();
select results_eq(
  $$ select status::text, number, year from public.documents
     where id in (tests.id('p2'), tests.id('future'), tests.id('due_before')) $$,
  $$ values ('draft', null::int, null::int), ('draft', null, null), ('draft', null, null) $$,
  'the rejected documents are still drafts without a number');

-- 3. COUNTERS match what was handed out ----------------------------------------------------
select results_eq(
  $$ select type::text, year, last_number from public.document_counters
     where organization_id = tests.id('org_a') order by type, year $$,
  $$ select * from (values
       ('devis', extract(year from private.today_tunis())::int, 1),
       ('facture', 2024, 3),
       ('facture', extract(year from private.today_tunis())::int, 3)) v $$,
  'one counter per (type, year), each equal to the last number handed out');
select results_eq(
  $$ select array_agg(number order by number) from public.documents
     where organization_id = tests.id('org_a') and type = 'facture'
       and year = extract(year from private.today_tunis())::int $$,
  $$ select array[1, 2, 3] $$,
  'the factures of the current year are numbered 1, 2, 3 with no gap');

-- 4. SNAPSHOTS ----------------------------------------------------------------------------
select results_eq(
  $$ select seller_name, seller_matricule_fiscal, seller_address,
            buyer_name, buyer_matricule_fiscal, buyer_address
     from public.documents where id = tests.id('f1') $$,
  $$ values ('Org A', 'MF-ORG-A', '1 rue A, Tunis', 'Client A', 'MF-CLIENT-A', '2 rue C, Sfax') $$,
  'seller and buyer identity are snapshotted');
select results_eq(
  $$ select timbre_fiscal, retenue_enabled, retenue_rate, retenue_threshold
     from public.documents where id = tests.id('f1') $$,
  $$ values (null::numeric, true, 1.5::numeric, 1000::numeric) $$,
  'tax settings are snapshotted; timbre is NULL because it was not enabled');
select results_eq(
  $$ select seller_name, buyer_name, timbre_fiscal, retenue_enabled from public.documents where id = tests.id('api_draft') $$,
  $$ values (null::text, null::text, null::numeric, null::boolean) $$,
  'a draft has no snapshot');

update public.organizations set name = 'Org A renamed', address = 'moved' where id = tests.id('org_a');
update public.clients set name = 'Client A renamed', matricule_fiscal = 'MF-NEW' where id = tests.id('client_a');
update public.tax_settings set retenue_rate = 99 where organization_id = tests.id('org_a');
select results_eq(
  $$ select seller_name, seller_address, buyer_name, buyer_matricule_fiscal, retenue_rate
     from public.documents where id = tests.id('f1') $$,
  $$ values ('Org A', '1 rue A, Tunis', 'Client A', 'MF-CLIENT-A', 1.5::numeric) $$,
  'snapshots do not follow later changes to the organization, the client or tax settings');

-- 5. TIMBRE RULE --------------------------------------------------------------------------
update public.tax_settings set timbre_enabled = false, timbre_fiscal = null where organization_id = tests.id('org_a');
select is(tests.finalize_as('alice@test.local', tests.id('t_off_null')), 4, 'timbre disabled and no amount: a facture is accepted');

-- "Enabled without an amount" is now refused at the source, for every role.
select throws_ok(
  $$ update public.tax_settings set timbre_enabled = true where organization_id = tests.id('org_a') $$,
  '23514', 'new row for relation "tax_settings" violates check constraint "tax_settings_timbre_enabled_has_amount"',
  'CHECK: the timbre cannot be enabled without an amount');

-- DF007 is the second line of defence behind that CHECK. It can only be reached if the
-- CHECK is gone, so the constraint is dropped here and put back below, once the amount is
-- set. This file runs in one transaction that is rolled back: nothing of it remains.
alter table public.tax_settings drop constraint tax_settings_timbre_enabled_has_amount;
update public.tax_settings set timbre_enabled = true where organization_id = tests.id('org_a');
select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ select public.finalize_document(tests.id('t_on_null')) $$,
  'DF007', 'timbre fiscal is enabled but its amount is not configured',
  'timbre enabled without an amount: a facture is rejected');
select tests.clear_auth();
select is(tests.finalize_as('alice@test.local', tests.id('dv_on_null')), 2, 'timbre enabled without an amount does not block a devis');

update public.tax_settings set timbre_fiscal = 9.999 where organization_id = tests.id('org_a');
alter table public.tax_settings
  add constraint tax_settings_timbre_enabled_has_amount check (not timbre_enabled or timbre_fiscal is not null);
select is(tests.finalize_as('alice@test.local', tests.id('t_on_amount')), 5, 'timbre enabled with an amount: accepted, and the rejected attempt consumed no number');
select is((select timbre_fiscal from public.documents where id = tests.id('t_on_amount')), 9.999::numeric, 'the timbre amount is snapshotted when enabled');
select is((select timbre_fiscal from public.documents where id = tests.id('t_off_null')), null::numeric, 'no timbre is snapshotted when disabled');
select is(tests.finalize_as('alice@test.local', tests.id('t_on_null')), 6, 'the facture rejected earlier can be finalized once the amount is set');

-- 6. VALIDATION ---------------------------------------------------------------------------
select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ select public.finalize_document(tests.id('no_client')) $$,
  'DF003', 'document has no client', 'a document without a client is rejected');
select throws_ok(
  $$ select public.finalize_document(tests.id('no_items')) $$,
  'DF004', 'document has no items', 'a document without items is rejected');
select throws_ok(
  $$ select public.finalize_document(tests.id('f1')) $$,
  'DF002', 'document is not a draft', 'a document that is already sent cannot be finalized again');
select tests.clear_auth();
select results_eq(
  $$ select status::text, number from public.documents where id = tests.id('f1') $$,
  $$ values ('sent', 1) $$,
  'the already sent document keeps its number');
select is(
  (select last_number from public.document_counters
   where organization_id = tests.id('org_a') and type = 'facture'
     and year = extract(year from private.today_tunis())::int),
  6, 'none of the rejected attempts consumed a number');

-- 7. THE API ROLE STILL CANNOT BYPASS finalize_document ------------------------------------
select tests.authenticate_as('alice@test.local');
select throws_ok($$ update public.documents set status = 'sent' where id = tests.id('api_draft') $$, '42501', null, 'direct UPDATE of status is still rejected');
select throws_ok($$ update public.documents set number = 99 where id = tests.id('api_draft') $$, '42501', null, 'direct UPDATE of number is still rejected');
select throws_ok($$ update public.documents set year = 2020 where id = tests.id('api_draft') $$, '42501', null, 'direct UPDATE of year is still rejected');
select throws_ok($$ update public.documents set seller_name = 'Fake seller' where id = tests.id('api_draft') $$, '42501', null, 'a seller snapshot column cannot be written directly');
select throws_ok($$ update public.documents set buyer_name = 'Fake buyer' where id = tests.id('api_draft') $$, '42501', null, 'a buyer snapshot column cannot be written directly');
select throws_ok($$ update public.documents set timbre_fiscal = 0 where id = tests.id('api_draft') $$, '42501', null, 'a tax snapshot column cannot be written directly');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, seller_name)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), 'Fake seller') $$,
  '42501', null, 'a snapshot column cannot be set at INSERT');
select throws_ok('select * from public.document_counters', '42501', null, 'counters are not readable from the API');
select throws_ok(
  $$ insert into public.document_counters (organization_id, type, year, last_number)
     values (tests.id('org_a'), 'facture', 2030, 500) $$,
  '42501', null, 'counters cannot be inserted from the API');
select throws_ok($$ update public.document_counters set last_number = 1 $$, '42501', null, 'counters cannot be updated from the API');
select throws_ok('delete from public.document_counters', '42501', null, 'counters cannot be deleted from the API');
select is_empty(
  $$ update public.documents set notes = 'edited after finalize' where id = tests.id('f1') returning 1 $$,
  'the content of a finalized document cannot be edited from the API');
select is_empty(
  $$ delete from public.document_items where document_id = tests.id('f1') returning 1 $$,
  'the items of a finalized document cannot be deleted from the API');

-- 8. OTHER ORGANIZATIONS, ANON, NO IDENTITY -------------------------------------------------
select throws_ok(
  $$ select public.finalize_document(tests.id('b_target')) $$,
  'DF001', 'document not found', 'another organization''s document is rejected with the generic error');
select throws_ok(
  $$ select public.finalize_document(gen_random_uuid()) $$,
  'DF001', 'document not found', 'an id that does not exist gets exactly the same error');

select tests.authenticate_as_anon();
select throws_ok(
  $$ select public.finalize_document(tests.id('api_draft')) $$,
  '42501', null, 'anon cannot call finalize_document');

-- The authenticated role, but a token without a user id.
select tests.clear_auth();
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('role', 'authenticated', true);
select throws_ok(
  $$ select public.finalize_document(tests.id('api_draft')) $$,
  'DF000', 'not authenticated', 'a call without a user id is rejected');

select tests.clear_auth();
select results_eq(
  $$ select status::text, number from public.documents where id in (tests.id('b_target'), tests.id('api_draft')) $$,
  $$ values ('draft', null::int), ('draft', null) $$,
  'the other organization''s draft and the attacked draft are untouched');
select is(
  (select sum(last_number)::int from public.document_counters where organization_id = tests.id('org_b')),
  1, 'the other organization''s counter is untouched');

select * from finish();
rollback;
