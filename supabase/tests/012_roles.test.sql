-- R1: roles per action (docs/roles-design.md, R-1 to R-3). Seed: in org_a, alice is the
-- owner, carol an admin, dave a member; bob is the owner of org_b.
-- Acceptance criteria checked here:
--   owner and admin can issue, record a payment and cancel a devis; a member gets DF026;
--   a document of another organization still answers DF001; no way around it through
--   direct table access; issued documents stay frozen; members keep what they had.
begin;
select * from no_plan();

select tests.seed();

-- Fixtures (as superuser). Numbers from 901 for hand-issued documents.
select tests.create_draft('a_draft_owner', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('a_draft_admin', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('a_draft_member', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('a_fac', tests.id('org_a'), tests.id('client_a'));
select tests.mark_sent(tests.id('a_fac'), 901);
select tests.create_draft('a_devis_owner', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('a_devis_owner'), 901);
select tests.create_draft('a_devis_admin', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('a_devis_admin'), 902);
select tests.create_draft('a_devis_member', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.mark_sent(tests.id('a_devis_member'), 903);
select tests.create_draft('b_draft', tests.id('org_b'), tests.id('client_b'));
select tests.create_draft('b_fac', tests.id('org_b'), tests.id('client_b'));
select tests.mark_sent(tests.id('b_fac'), 901);
select tests.create_draft('b_devis', tests.id('org_b'), tests.id('client_b'), 'devis');
select tests.mark_sent(tests.id('b_devis'), 901);

-- 1. A MEMBER: DF026 on the three actions, nothing changed --------------------------------
select tests.authenticate_as('dave@test.local');
select throws_ok($$ select public.finalize_document(tests.id('a_draft_member'), '100.000') $$, 'DF026', null, 'member: finalize_document gives DF026');
select throws_ok($$ select public.record_payment(tests.id('a_fac'), '10.000', current_date, 'cash') $$, 'DF026', null, 'member: record_payment gives DF026');
select throws_ok($$ select public.cancel_devis(tests.id('a_devis_member')) $$, 'DF026', null, 'member: cancel_devis gives DF026');
-- Another organization: still DF001, the role is never even looked at.
select throws_ok($$ select public.finalize_document(tests.id('b_draft'), '100.000') $$, 'DF001', null, 'member, other organization: finalize gives DF001, not DF026');
select throws_ok($$ select public.record_payment(tests.id('b_fac'), '10.000', current_date, 'cash') $$, 'DF001', null, 'member, other organization: record_payment gives DF001');
select throws_ok($$ select public.cancel_devis(tests.id('b_devis')) $$, 'DF001', null, 'member, other organization: cancel_devis gives DF001');
select tests.clear_auth();
select is((select status::text from public.documents where id = tests.id('a_draft_member')), 'draft', 'the member''s refused draft is still a draft');
select is((select count(*)::int from public.payments where document_id = tests.id('a_fac')), 0, 'no payment was recorded');
select is((select status::text from public.documents where id = tests.id('a_devis_member')), 'sent', 'the devis is still sent');

-- 2. A MEMBER: no way around it through the tables ------------------------------------------
select tests.authenticate_as('dave@test.local');
select throws_ok($$ update public.documents set status = 'sent' where id = tests.id('a_draft_member') $$, '42501', null, 'member: status cannot be written directly');
select throws_ok($$ update public.documents set status = 'cancelled' where id = tests.id('a_devis_member') $$, '42501', null, 'member: a devis cannot be cancelled by an UPDATE');
select throws_ok($$ update public.documents set number = 7, year = 2026 where id = tests.id('a_draft_member') $$, '42501', null, 'member: number and year cannot be written');
select throws_ok($$ update public.documents set seller_name = 'x', net_a_payer = 1 where id = tests.id('a_draft_member') $$, '42501', null, 'member: snapshots and totals cannot be written');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, status) values (tests.id('org_a'), 'facture', tests.id('client_a'), 'sent') $$,
  '42501', null, 'member: a document cannot be inserted as sent');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method) values (tests.id('org_a'), tests.id('a_fac'), 1, current_date, 'cash') $$,
  '42501', null, 'member: a payment cannot be inserted directly');
select throws_ok($$ select * from public.document_counters $$, '42501', null, 'member: the counters are not readable');
select is_empty($$ update public.documents set notes = 'x' where id = tests.id('a_fac') returning 1 $$, 'member: an issued document matches no UPDATE (RLS)');
select is_empty($$ delete from public.documents where id = tests.id('a_fac') returning 1 $$, 'member: an issued document matches no DELETE (RLS)');
select is_empty($$ update public.document_items set description = 'x' where document_id = tests.id('a_fac') returning 1 $$, 'member: the lines of an issued document match no UPDATE');
select is_empty($$ update public.tax_settings set timbre_enabled = false where organization_id = tests.id('org_a') returning 1 $$, 'member: tax settings are not writable (unchanged)');
select is_empty($$ update public.organizations set name = 'x' where id = tests.id('org_a') returning 1 $$, 'member: the organization identity is not writable (unchanged)');

-- 3. A MEMBER keeps what a member had ------------------------------------------------------
select lives_ok(
  $$ insert into public.documents (organization_id, type, client_id) values (tests.id('org_a'), 'facture', tests.id('client_a')) $$,
  'member: can still create a draft');
select lives_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('a_draft_member'), 'Ligne', 1, 1, 0) $$,
  'member: can still add a line to a draft');
select lives_ok($$ update public.clients set name = 'Client renommé' where id = tests.id('client_a') $$, 'member: can still edit a client');
select lives_ok($$ select public.convert_devis_to_facture(tests.id('a_devis_member')) $$, 'member: can convert a devis into a DRAFT facture (R-2)');
select isnt_empty($$ select 1 from public.documents where id = tests.id('a_fac') $$, 'member: can still read the organization''s issued documents');
select tests.clear_auth();

-- 4. ADMIN and OWNER: the three actions ----------------------------------------------------
select tests.authenticate_as('carol@test.local');
select lives_ok($$ select public.finalize_document(tests.id('a_draft_admin'), '100.000') $$, 'admin: can finalize');
select lives_ok($$ select public.record_payment(tests.id('a_fac'), '10.000', current_date, 'cash') $$, 'admin: can record a payment');
select lives_ok($$ select public.cancel_devis(tests.id('a_devis_admin')) $$, 'admin: can cancel a devis');
select throws_ok($$ select public.finalize_document(tests.id('b_draft'), '100.000') $$, 'DF001', null, 'admin, other organization: DF001');
select tests.clear_auth();

select tests.authenticate_as('alice@test.local');
select lives_ok($$ select public.finalize_document(tests.id('a_draft_owner'), '100.000') $$, 'owner: can finalize');
select lives_ok($$ select public.record_payment(tests.id('a_fac'), '90.000', current_date, 'virement') $$, 'owner: can record a payment');
select lives_ok($$ select public.cancel_devis(tests.id('a_devis_owner')) $$, 'owner: can cancel a devis');
select throws_ok($$ select public.cancel_devis(tests.id('b_devis')) $$, 'DF001', null, 'owner, other organization: DF001');
select tests.clear_auth();

select results_eq(
  $$ select (select status::text from public.documents where id = tests.id('a_draft_admin')),
            (select status::text from public.documents where id = tests.id('a_draft_owner')),
            (select status::text from public.documents where id = tests.id('a_fac')),
            (select status::text from public.documents where id = tests.id('a_devis_admin')),
            (select status::text from public.documents where id = tests.id('a_devis_owner')) $$,
  $$ values ('sent', 'sent', 'paid', 'cancelled', 'cancelled') $$,
  'what admin and owner did is stored: two issued, one facture paid by their two payments, two devis cancelled');

-- 5. Issued documents stay frozen for every role --------------------------------------------
select throws_ok($$ update public.documents set notes = 'x' where id = tests.id('a_draft_owner') $$, 'DF011', null, 'superuser: an issued document is still frozen');
select tests.authenticate_as('alice@test.local');
select is_empty($$ update public.documents set notes = 'x' where id = tests.id('a_draft_owner') returning 1 $$, 'owner: an issued document matches no UPDATE');
select tests.clear_auth();

-- 6. The three functions check the role with the right helper, after the membership check.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('finalize_document', 'record_payment', 'cancel_devis')
     and position('DF026' in p.prosrc) > position('DF001' in p.prosrc)
     and position('DF001' in p.prosrc) > 0
     and p.prosrc like '%private.has_org_role(v_doc.organization_id, array[''owner'', ''admin'']::public.org_role[])%'),
  3, 'the three functions check owner/admin AFTER the DF001 membership check');
select is(
  (select position('DF026' in p.prosrc) from pg_proc p where p.oid = 'public.convert_devis_to_facture(uuid)'::regprocedure),
  0, 'convert_devis_to_facture does not check the role (R-2)');

select * from finish();
rollback;
