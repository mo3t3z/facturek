-- P2f: convert_devis_to_facture(). One facture per devis (DF025 from the function, 23505
-- from the index for any other path), lines copied, the new facture is a plain draft.
begin;
select * from no_plan();

select tests.seed();

-- Fixtures (as superuser). Numbers from 901 to stay clear of any other series.
select tests.create_draft('dv', tests.id('org_a'), tests.id('client_a'), 'devis');
insert into public.document_items (organization_id, document_id, position, description, quantity, unit_price, tva_rate)
values (tests.id('org_a'), tests.id('dv'), 5, 'Seconde ligne', 2.500, 40.125, 19);
update public.documents set notes = 'Conditions du devis' where id = tests.id('dv');
select tests.mark_sent(tests.id('dv'), 901);
select tests.create_draft('dv_draft', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.create_draft('dv_cancelled', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('dv_cancelled'), 902);
update public.documents set status = 'cancelled' where id = tests.id('dv_cancelled');
select tests.create_draft('fac', tests.id('org_a'), tests.id('client_a'));
select tests.mark_sent(tests.id('fac'), 901);
select tests.create_draft('dv_b', tests.id('org_b'), tests.id('client_b'), 'devis');
select tests.mark_sent(tests.id('dv_b'), 901);
select tests.create_draft('dv_again', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('dv_again'), 903);

-- 1. Privileges -------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.convert_devis_to_facture(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.convert_devis_to_facture(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.convert_devis_to_facture(uuid)', 'EXECUTE'),
  'only authenticated can execute convert_devis_to_facture');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_proc p where p.oid = 'public.convert_devis_to_facture(uuid)'::regprocedure),
  true, 'it is SECURITY DEFINER with an empty search_path');
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'documents_one_facture_per_devis'),
  'CREATE UNIQUE INDEX documents_one_facture_per_devis ON public.documents USING btree (organization_id, converted_from) WHERE (converted_from IS NOT NULL)',
  'the index that allows one facture per devis exists');

-- 2. Refusals, in order -----------------------------------------------------------------
select throws_ok($$ select public.convert_devis_to_facture(tests.id('dv')) $$, 'DF000', null, 'no user id: DF000');

select tests.authenticate_as('alice@test.local');
select throws_ok($$ select public.convert_devis_to_facture(gen_random_uuid()) $$, 'DF001', null, 'unknown id: DF001');
select throws_ok($$ select public.convert_devis_to_facture(tests.id('dv_b')) $$, 'DF001', null, 'another organization''s devis: DF001, like an unknown id');
select throws_ok($$ select public.convert_devis_to_facture(tests.id('dv_draft')) $$, 'DF013', null, 'a draft devis: DF013');
select throws_ok($$ select public.convert_devis_to_facture(tests.id('dv_cancelled')) $$, 'DF013', null, 'a cancelled devis: DF013');
select throws_ok($$ select public.convert_devis_to_facture(tests.id('fac')) $$, 'DF013', null, 'a facture: DF013');

-- 3. The conversion -----------------------------------------------------------------------
select lives_ok(
  $$ select tests.remember('fac_from_dv', (public.convert_devis_to_facture(tests.id('dv'))).id) $$,
  'a sent devis is converted');
select tests.clear_auth();

select results_eq(
  $$ select type::text, status::text, number, year, organization_id, client_id, converted_from, notes, issue_date, due_date, net_a_payer
     from public.documents where id = tests.id('fac_from_dv') $$,
  $$ select 'facture', 'draft', null::int, null::int, tests.id('org_a'), tests.id('client_a'), tests.id('dv'), 'Conditions du devis', null::date, null::date, null::numeric $$,
  'the new document is a draft facture of the same organization and client, linked to the devis, with its notes, no number, no date and no total');
select results_eq(
  $$ select position, description, quantity, unit_price, tva_rate from public.document_items
     where document_id = tests.id('fac_from_dv') order by position $$,
  $$ select position, description, quantity, unit_price, tva_rate from public.document_items
     where document_id = tests.id('dv') order by position $$,
  'every line of the devis is copied, with the same values');
select is((select count(*)::int from public.document_items where document_id = tests.id('dv')), 2, 'the devis keeps its own lines');
select is((select status::text from public.documents where id = tests.id('dv')), 'sent', 'the devis itself does not change');

-- 4. One facture per devis ------------------------------------------------------------------
select tests.authenticate_as('alice@test.local');
select throws_ok($$ select public.convert_devis_to_facture(tests.id('dv')) $$, 'DF025', null, 'a second conversion: DF025');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('dv')) $$,
  '23505', null, 'any other path to a second facture: 23505 (the index)');
select throws_ok($$ select public.cancel_devis(tests.id('dv')) $$, 'DF021', null, 'the converted devis cannot be cancelled (DF021)');

-- The draft facture is a normal draft: it can be edited, and deleted.
select lives_ok(
  $$ update public.documents set notes = 'Modifiée' where id = tests.id('fac_from_dv') $$,
  'the converted facture is editable like any draft');
select lives_ok($$ delete from public.documents where id = tests.id('fac_from_dv') $$, 'and it can be deleted');
select lives_ok($$ select public.convert_devis_to_facture(tests.id('dv')) $$, 'then the devis can be converted again');
select tests.clear_auth();

select tests.authenticate_as('bob@test.local');
select is_empty($$ select 1 from public.documents where converted_from = tests.id('dv') $$, 'B sees none of A''s converted factures');
select tests.clear_auth();

-- 5. A devis without lines would give a facture without lines: still a valid draft.
select tests.authenticate_as('alice@test.local');
delete from public.document_items where document_id = tests.id('dv_again');
select tests.clear_auth();
select is((select count(*)::int from public.document_items where document_id = tests.id('dv_again')), 1,
  'the lines of an issued devis cannot be deleted (DF014 / RLS), so a devis always has lines');

select * from finish();
rollback;
