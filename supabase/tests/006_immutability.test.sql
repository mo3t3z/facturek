-- Checkpoint C3: rules that bind EVERY role.
-- Each rule is exercised twice: as superuser (no RLS, no column privileges: only triggers
-- and CHECK constraints stand in the way) and as the API role.
-- Every section uses its own documents, so one broken rule cannot hide another.
begin;
select * from no_plan();

select tests.seed();
insert into public.clients (organization_id, name) values (tests.id('org_a'), 'Second client')
returning tests.remember('client_a2', id);

-- Issued documents are produced by finalize_document(), like in real use.
create function pg_temp.issued(p_key text, p_type public.document_type default 'facture')
returns void
language plpgsql
as $$
begin
  perform tests.create_draft(p_key, tests.id('org_a'), tests.id('client_a'), p_type);
  perform tests.finalize_as('alice@test.local', tests.id(p_key));
end;
$$;

-- A. frozen columns
select pg_temp.issued('fac_frozen');
select pg_temp.issued('dev_link', 'devis');
-- B. delete
select pg_temp.issued('fac_del');
select tests.create_draft('draft_del_api', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('draft_del_su', tests.id('org_a'), tests.id('client_a'));
insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
values (tests.id('org_a'), tests.id('draft_del_api'), 'second', 1, 1, 0),
       (tests.id('org_a'), tests.id('draft_del_su'), 'second', 1, 1, 0);
-- C. status transitions
select pg_temp.issued('fac_tr');
select pg_temp.issued('fac_to_pay');
select pg_temp.issued('dev_tr', 'devis');
select pg_temp.issued('dev_to_cancel', 'devis');
select tests.create_draft('tr_draft_f', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('tr_draft_d', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.create_draft('tr_draft_manual', tests.id('org_a'), tests.id('client_a'));
-- D. items
select pg_temp.issued('fac_items');
select pg_temp.issued('fac_items_paid');
update public.documents set status = 'paid' where id = tests.id('fac_items_paid');
select tests.create_draft('draft_items_1', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('draft_items_2', tests.id('org_a'), tests.id('client_a'));
-- E. payments
select pg_temp.issued('fac_pay');
select pg_temp.issued('fac_pay_paid');
update public.documents set status = 'paid' where id = tests.id('fac_pay_paid');
select pg_temp.issued('dev_pay', 'devis');
select pg_temp.issued('dev_pay_cancelled', 'devis');
update public.documents set status = 'cancelled' where id = tests.id('dev_pay_cancelled');
select tests.create_draft('fac_pay_draft', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('dev_pay_draft', tests.id('org_a'), tests.id('client_a'), 'devis');
-- A cancelled facture cannot be reached through any transition; a privileged INSERT
-- directly in that state is the only way such a row can exist.
insert into public.documents (organization_id, type, status, number, year, client_id, issue_date,
                              seller_name, buyer_name, retenue_enabled)
values (tests.id('org_a'), 'facture', 'cancelled', 900, 2020, tests.id('client_a'), date '2020-01-01',
        'Test seller', 'Test buyer', false)
returning tests.remember('fac_pay_cancelled', id);
-- F. converted_from
select pg_temp.issued('dev_src', 'devis');
select pg_temp.issued('dev_src_cancelled', 'devis');
update public.documents set status = 'cancelled' where id = tests.id('dev_src_cancelled');
select pg_temp.issued('dev_src_later', 'devis');
select pg_temp.issued('fac_src');
select tests.create_draft('dev_src_draft', tests.id('org_a'), tests.id('client_a'), 'devis');
select tests.create_draft('conv_draft', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('conv_life', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('conv_devis', tests.id('org_a'), tests.id('client_a'), 'devis');
-- G. completeness CHECK
select tests.create_draft('g_draft', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('g_no_client', tests.id('org_a'), null);
-- Another organization.
select tests.create_draft('b_draft', tests.id('org_b'), tests.id('client_b'));
select tests.create_draft('b_sent', tests.id('org_b'), tests.id('client_b'));
select tests.finalize_as('bob@test.local', tests.id('b_sent'));

create temp table frozen_before as
select to_jsonb(d) - 'updated_at' as doc from public.documents d where d.id = tests.id('fac_frozen');

-- =========================================================================================
-- A. EVERY COLUMN OF A SENT DOCUMENT IS FROZEN
-- =========================================================================================
-- As superuser: only the trigger stands in the way.
select throws_ok($$ update public.documents set id = gen_random_uuid() where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: id is frozen');
select throws_ok($$ update public.documents set organization_id = tests.id('org_b') where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: organization_id is frozen');
select throws_ok($$ update public.documents set type = 'devis' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: type is frozen');
select throws_ok($$ update public.documents set number = number + 100 where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: number is frozen');
select throws_ok($$ update public.documents set year = year - 1 where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: year is frozen');
select throws_ok($$ update public.documents set client_id = tests.id('client_a2') where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: client_id is frozen');
select throws_ok($$ update public.documents set issue_date = issue_date - 1 where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: issue_date is frozen');
select throws_ok($$ update public.documents set due_date = date '2030-01-01' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: due_date is frozen');
select throws_ok($$ update public.documents set currency = 'EUR' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: currency is frozen');
select throws_ok($$ update public.documents set notes = 'edited' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: notes is frozen');
select throws_ok($$ update public.documents set converted_from = tests.id('dev_link') where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: converted_from is frozen');
select throws_ok($$ update public.documents set created_at = created_at - interval '1 day' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: created_at is frozen');
select throws_ok($$ update public.documents set seller_name = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: seller_name is frozen');
select throws_ok($$ update public.documents set seller_matricule_fiscal = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: seller_matricule_fiscal is frozen');
select throws_ok($$ update public.documents set seller_address = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: seller_address is frozen');
select throws_ok($$ update public.documents set buyer_name = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: buyer_name is frozen');
select throws_ok($$ update public.documents set buyer_matricule_fiscal = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: buyer_matricule_fiscal is frozen');
select throws_ok($$ update public.documents set buyer_address = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: buyer_address is frozen');
select throws_ok($$ update public.documents set timbre_fiscal = 1 where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: timbre_fiscal is frozen');
select throws_ok($$ update public.documents set retenue_enabled = not retenue_enabled where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: retenue_enabled is frozen');
select throws_ok($$ update public.documents set retenue_rate = 1 where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: retenue_rate is frozen');
select throws_ok($$ update public.documents set retenue_threshold = 1 where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: retenue_threshold is frozen');
select throws_ok(
  $$ update public.documents set status = 'paid', notes = 'slipped in' where id = tests.id('fac_frozen') $$,
  'DF011', null, 'superuser: content cannot ride along with an allowed status change');
select throws_ok(
  $$ update public.documents set notes = 'edited' where id = tests.id('fac_frozen') $$,
  'DF011', 'a sent document is frozen; cannot change: notes', 'the error names the frozen column');

-- A column added by a future migration is frozen without touching the trigger.
alter table public.documents add column future_column text;
select throws_ok($$ update public.documents set future_column = 'x' where id = tests.id('fac_frozen') $$, 'DF011', null, 'superuser: a column added later is frozen automatically');
alter table public.documents drop column future_column;

-- What is still allowed: an update that changes nothing, and updated_at.
select lives_ok($$ update public.documents set notes = notes where id = tests.id('fac_frozen') $$, 'an update that changes nothing is accepted');
select lives_ok($$ update public.documents set updated_at = now() where id = tests.id('fac_frozen') $$, 'updated_at alone may change');

-- As the API role: column privileges or RLS refuse first.
select tests.authenticate_as('alice@test.local');
select is_empty($$ update public.documents set client_id = tests.id('client_a2') where id = tests.id('fac_frozen') returning 1 $$, 'API: client_id of a sent document cannot be changed');
select is_empty($$ update public.documents set issue_date = date '2020-01-01' where id = tests.id('fac_frozen') returning 1 $$, 'API: issue_date of a sent document cannot be changed');
select is_empty($$ update public.documents set due_date = date '2030-01-01' where id = tests.id('fac_frozen') returning 1 $$, 'API: due_date of a sent document cannot be changed');
select is_empty($$ update public.documents set notes = 'edited' where id = tests.id('fac_frozen') returning 1 $$, 'API: notes of a sent document cannot be changed');
select is_empty($$ update public.documents set converted_from = tests.id('dev_link') where id = tests.id('fac_frozen') returning 1 $$, 'API: converted_from of a sent document cannot be changed');
select throws_ok($$ update public.documents set id = gen_random_uuid() where id = tests.id('fac_frozen') $$, '42501', null, 'API: id cannot be written');
select throws_ok($$ update public.documents set organization_id = tests.id('org_b') where id = tests.id('fac_frozen') $$, '42501', null, 'API: organization_id cannot be written');
select throws_ok($$ update public.documents set type = 'devis' where id = tests.id('fac_frozen') $$, '42501', null, 'API: type cannot be written');
select throws_ok($$ update public.documents set number = 99 where id = tests.id('fac_frozen') $$, '42501', null, 'API: number cannot be written');
select throws_ok($$ update public.documents set year = 2020 where id = tests.id('fac_frozen') $$, '42501', null, 'API: year cannot be written');
select throws_ok($$ update public.documents set currency = 'EUR' where id = tests.id('fac_frozen') $$, '42501', null, 'API: currency cannot be written');
select throws_ok($$ update public.documents set created_at = now() where id = tests.id('fac_frozen') $$, '42501', null, 'API: created_at cannot be written');
select throws_ok($$ update public.documents set updated_at = now() where id = tests.id('fac_frozen') $$, '42501', null, 'API: updated_at cannot be written');
select throws_ok($$ update public.documents set seller_name = 'x' where id = tests.id('fac_frozen') $$, '42501', null, 'API: seller_name cannot be written');
select throws_ok($$ update public.documents set seller_matricule_fiscal = 'x' where id = tests.id('fac_frozen') $$, '42501', null, 'API: seller_matricule_fiscal cannot be written');
select throws_ok($$ update public.documents set seller_address = 'x' where id = tests.id('fac_frozen') $$, '42501', null, 'API: seller_address cannot be written');
select throws_ok($$ update public.documents set buyer_name = 'x' where id = tests.id('fac_frozen') $$, '42501', null, 'API: buyer_name cannot be written');
select throws_ok($$ update public.documents set buyer_matricule_fiscal = 'x' where id = tests.id('fac_frozen') $$, '42501', null, 'API: buyer_matricule_fiscal cannot be written');
select throws_ok($$ update public.documents set buyer_address = 'x' where id = tests.id('fac_frozen') $$, '42501', null, 'API: buyer_address cannot be written');
select throws_ok($$ update public.documents set timbre_fiscal = 1 where id = tests.id('fac_frozen') $$, '42501', null, 'API: timbre_fiscal cannot be written');
select throws_ok($$ update public.documents set retenue_enabled = true where id = tests.id('fac_frozen') $$, '42501', null, 'API: retenue_enabled cannot be written');
select throws_ok($$ update public.documents set retenue_rate = 1 where id = tests.id('fac_frozen') $$, '42501', null, 'API: retenue_rate cannot be written');
select throws_ok($$ update public.documents set retenue_threshold = 1 where id = tests.id('fac_frozen') $$, '42501', null, 'API: retenue_threshold cannot be written');
select tests.clear_auth();

select is(
  (select to_jsonb(d) - 'updated_at' from public.documents d where d.id = tests.id('fac_frozen')),
  (select doc from frozen_before),
  'after every attempt, by both roles, the sent document is identical to what it was');

-- =========================================================================================
-- B. DELETE
-- =========================================================================================
select throws_ok($$ delete from public.documents where id = tests.id('fac_del') $$, 'DF010', null, 'superuser: a sent document cannot be deleted');
select throws_ok($$ delete from public.documents where id = tests.id('fac_items_paid') $$, 'DF010', null, 'superuser: a paid document cannot be deleted');
select throws_ok($$ delete from public.documents where id = tests.id('dev_pay_cancelled') $$, 'DF010', null, 'superuser: a cancelled document cannot be deleted');
select is((select count(*)::int from public.document_items where document_id = tests.id('fac_del')), 1, 'the items of the sent document are still there');
select lives_ok($$ delete from public.documents where id = tests.id('draft_del_su') $$, 'superuser: a draft with items can be deleted');
select is((select count(*)::int from public.document_items where document_id = tests.id('draft_del_su')), 0, 'superuser: its items went with it (cascade)');

select tests.authenticate_as('alice@test.local');
select is_empty($$ delete from public.documents where id = tests.id('fac_del') returning 1 $$, 'API: a sent document cannot be deleted');
select isnt_empty($$ delete from public.documents where id = tests.id('draft_del_api') returning 1 $$, 'API: a draft with items can be deleted');
select tests.clear_auth();
select is((select count(*)::int from public.document_items where document_id = tests.id('draft_del_api')), 0, 'API: its items went with it (cascade)');
select isnt_empty($$ select 1 from public.documents where id = tests.id('fac_del') $$, 'the sent document still exists');

-- =========================================================================================
-- C. STATUS TRANSITIONS
-- =========================================================================================
-- Allowed.
select lives_ok($$ select tests.mark_sent(tests.id('tr_draft_manual'), 700, 2021) $$, 'draft -> sent is allowed when the document is complete');
select lives_ok($$ update public.documents set status = 'paid' where id = tests.id('fac_to_pay') $$, 'facture: sent -> paid is allowed');
select lives_ok($$ update public.documents set status = 'cancelled' where id = tests.id('dev_to_cancel') $$, 'devis: sent -> cancelled is allowed');

-- Forbidden, as superuser.
select throws_ok($$ update public.documents set status = 'cancelled' where id = tests.id('fac_tr') $$, 'DF012', null, 'facture: sent -> cancelled is rejected (a numbered facture cannot be cancelled)');
select throws_ok($$ update public.documents set status = 'draft' where id = tests.id('fac_tr') $$, 'DF012', null, 'facture: sent -> draft is rejected');
select throws_ok($$ update public.documents set status = 'sent' where id = tests.id('fac_to_pay') $$, 'DF012', null, 'facture: paid -> sent is rejected');
select throws_ok($$ update public.documents set status = 'cancelled' where id = tests.id('fac_to_pay') $$, 'DF012', null, 'facture: paid -> cancelled is rejected');
select throws_ok($$ update public.documents set status = 'draft' where id = tests.id('fac_to_pay') $$, 'DF012', null, 'facture: paid -> draft is rejected');
select throws_ok($$ update public.documents set status = 'paid' where id = tests.id('dev_tr') $$, 'DF012', null, 'devis: sent -> paid is rejected');
select throws_ok($$ update public.documents set status = 'draft' where id = tests.id('dev_tr') $$, 'DF012', null, 'devis: sent -> draft is rejected');
select throws_ok($$ update public.documents set status = 'sent' where id = tests.id('dev_to_cancel') $$, 'DF012', null, 'devis: cancelled -> sent is rejected');
select throws_ok($$ update public.documents set status = 'draft' where id = tests.id('dev_to_cancel') $$, 'DF012', null, 'devis: cancelled -> draft is rejected');
select throws_ok($$ update public.documents set status = 'paid' where id = tests.id('dev_to_cancel') $$, 'DF012', null, 'devis: cancelled -> paid is rejected');
select throws_ok($$ update public.documents set status = 'paid' where id = tests.id('tr_draft_f') $$, 'DF012', null, 'facture: draft -> paid is rejected');
select throws_ok($$ update public.documents set status = 'cancelled' where id = tests.id('tr_draft_d') $$, 'DF012', null, 'devis: draft -> cancelled is rejected');
select throws_ok(
  $$ update public.documents set status = 'draft', number = null, year = null where id = tests.id('fac_tr') $$,
  'DF012', null, 'a sent facture cannot be turned back into a draft by also clearing its number');

-- A paid or cancelled document is just as frozen as a sent one.
select throws_ok($$ update public.documents set notes = 'edited' where id = tests.id('fac_to_pay') $$, 'DF011', null, 'a paid facture is frozen');
select throws_ok($$ update public.documents set notes = 'edited' where id = tests.id('dev_to_cancel') $$, 'DF011', null, 'a cancelled devis is frozen');

-- The API role cannot write status at all.
select tests.authenticate_as('alice@test.local');
select throws_ok($$ update public.documents set status = 'paid' where id = tests.id('fac_tr') $$, '42501', null, 'API: an allowed transition is still not available to the API role');
select throws_ok($$ update public.documents set status = 'cancelled' where id = tests.id('fac_tr') $$, '42501', null, 'API: a forbidden transition is rejected');
select throws_ok($$ update public.documents set status = 'sent' where id = tests.id('tr_draft_f') $$, '42501', null, 'API: draft -> sent is only available through finalize_document');
select tests.clear_auth();

select results_eq(
  $$ select status::text from public.documents
     where id in (tests.id('fac_tr'), tests.id('dev_tr'), tests.id('tr_draft_f'), tests.id('tr_draft_d'))
     order by status $$,
  $$ values ('draft'), ('draft'), ('sent'), ('sent') $$,
  'after every rejected transition the documents kept their status');

-- =========================================================================================
-- D. ITEMS
-- =========================================================================================
-- As superuser.
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('fac_items'), 'late', 1, 1, 0) $$,
  'DF014', null, 'superuser: an item cannot be added to a sent document');
select throws_ok($$ update public.document_items set unit_price = 0 where id = tests.id('fac_items:item') $$, 'DF014', null, 'superuser: an item of a sent document cannot be updated');
select throws_ok($$ delete from public.document_items where id = tests.id('fac_items:item') $$, 'DF014', null, 'superuser: an item of a sent document cannot be deleted');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('fac_items_paid'), 'late', 1, 1, 0) $$,
  'DF014', null, 'superuser: an item cannot be added to a paid document');
select throws_ok(
  $$ update public.document_items set document_id = tests.id('draft_items_2') where id = tests.id('draft_items_1:item') $$,
  'DF015', null, 'superuser: an item cannot be moved to another document, even between two drafts');
select throws_ok(
  $$ update public.document_items set organization_id = tests.id('org_b') where id = tests.id('draft_items_1:item') $$,
  'DF015', null, 'superuser: an item cannot be moved to another organization');
select throws_ok(
  $$ update public.document_items set document_id = tests.id('draft_items_1') where id = tests.id('fac_items:item') $$,
  'DF015', null, 'superuser: an item cannot be moved out of a sent document');
select lives_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('draft_items_1'), 'extra', 1, 1, 0) $$,
  'superuser: an item can be added to a draft');
select lives_ok($$ update public.document_items set unit_price = 5 where id = tests.id('draft_items_1:item') $$, 'superuser: an item of a draft can be updated');
select lives_ok($$ delete from public.document_items where document_id = tests.id('draft_items_1') and description = 'extra' $$, 'superuser: an item of a draft can be deleted');

-- As the API role.
select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('fac_items'), 'late', 1, 1, 0) $$,
  'DF014', null, 'API: an item cannot be added to a sent document');
select is_empty($$ update public.document_items set unit_price = 0 where id = tests.id('fac_items:item') returning 1 $$, 'API: an item of a sent document cannot be updated');
select is_empty($$ delete from public.document_items where id = tests.id('fac_items:item') returning 1 $$, 'API: an item of a sent document cannot be deleted');
select throws_ok(
  $$ update public.document_items set document_id = tests.id('draft_items_2') where id = tests.id('draft_items_1:item') $$,
  '42501', null, 'API: an item cannot be moved to another document');
select lives_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('draft_items_2'), 'extra', 1, 1, 0) $$,
  'API: an item can be added to a draft');
select isnt_empty($$ update public.document_items set unit_price = 7 where id = tests.id('draft_items_2:item') returning 1 $$, 'API: an item of a draft can be updated');
select isnt_empty($$ delete from public.document_items where document_id = tests.id('draft_items_2') and description = 'extra' returning 1 $$, 'API: an item of a draft can be deleted');

-- A user of another organization learns nothing about the parent document: the error is
-- the same whether that document is a draft or already sent.
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_b'), tests.id('b_draft'), 'x', 1, 1, 0) $$,
  '42501', 'permission denied', 'API: an item for another organization''s DRAFT is refused');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_b'), tests.id('b_sent'), 'x', 1, 1, 0) $$,
  '42501', 'permission denied', 'API: an item for another organization''s SENT document is refused with the identical error');
select tests.clear_auth();

select results_eq(
  $$ select count(*)::int, min(unit_price), max(description)
     from public.document_items where document_id in (tests.id('fac_items'), tests.id('fac_items_paid')) $$,
  $$ values (2, 100.000::numeric, 'Prestation') $$,
  'after every attempt the items of the issued documents are unchanged');

-- =========================================================================================
-- E. PAYMENTS
-- =========================================================================================
-- As superuser.
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay_draft'), 1, current_date, 'cash') $$,
  'DF016', null, 'superuser: no payment on a draft facture');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('dev_pay'), 1, current_date, 'cash') $$,
  'DF016', null, 'superuser: no payment on a sent devis');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('dev_pay_draft'), 1, current_date, 'cash') $$,
  'DF016', null, 'superuser: no payment on a draft devis');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('dev_pay_cancelled'), 1, current_date, 'cash') $$,
  'DF016', null, 'superuser: no payment on a cancelled devis');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay_paid'), 1, current_date, 'cash') $$,
  'DF016', null, 'superuser: no payment on a paid facture');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay_cancelled'), 1, current_date, 'cash') $$,
  'DF016', null, 'superuser: no payment on a cancelled facture');
insert into public.payments (organization_id, document_id, amount, paid_at, method)
values (tests.id('org_a'), tests.id('fac_pay'), 40.000, current_date, 'virement')
returning tests.remember('payment_1', id);
select is((select count(*)::int from public.payments where document_id = tests.id('fac_pay')), 1, 'superuser: a payment on a sent facture is accepted');
select throws_ok($$ update public.payments set amount = 1 where id = tests.id('payment_1') $$, 'DF017', null, 'superuser: a payment cannot be updated');
select throws_ok($$ update public.payments set paid_at = current_date - 30 where id = tests.id('payment_1') $$, 'DF017', null, 'superuser: a payment cannot be backdated');
select throws_ok($$ delete from public.payments where id = tests.id('payment_1') $$, 'DF017', null, 'superuser: a payment cannot be deleted');

-- As the API role.
select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay_draft'), 1, current_date, 'cash') $$,
  'DF016', null, 'API: no payment on a draft facture');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('dev_pay'), 1, current_date, 'cash') $$,
  'DF016', null, 'API: no payment on a sent devis');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay_paid'), 1, current_date, 'cash') $$,
  'DF016', null, 'API: no payment on a paid facture');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay_cancelled'), 1, current_date, 'cash') $$,
  'DF016', null, 'API: no payment on a cancelled facture');
select lives_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('fac_pay'), 10.500, current_date, 'cheque') $$,
  'API: a payment on a sent facture is accepted');
select throws_ok($$ update public.payments set amount = 1 where id = tests.id('payment_1') $$, '42501', null, 'API: a payment cannot be updated');
select throws_ok($$ delete from public.payments where id = tests.id('payment_1') $$, '42501', null, 'API: a payment cannot be deleted');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_b'), tests.id('b_sent'), 1, current_date, 'cash') $$,
  '42501', 'permission denied', 'API: a payment for another organization''s SENT facture is refused');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_b'), tests.id('b_draft'), 1, current_date, 'cash') $$,
  '42501', 'permission denied', 'API: a payment for another organization''s DRAFT is refused with the identical error');
select tests.clear_auth();

select results_eq(
  $$ select count(*)::int, sum(amount) from public.payments where organization_id = tests.id('org_a') $$,
  $$ values (2, 50.500::numeric) $$,
  'exactly the two accepted payments exist, with their original amounts');
select is((select count(*)::int from public.payments where organization_id = tests.id('org_b')), 0, 'no payment reached the other organization');

-- =========================================================================================
-- F. converted_from
-- =========================================================================================
-- As the API role.
select tests.authenticate_as('alice@test.local');
select lives_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('dev_src')) $$,
  'API: a facture can be created from a sent devis');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'devis', tests.id('client_a'), tests.id('dev_src')) $$,
  'DF013', null, 'API: a devis cannot be converted from anything');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('fac_src')) $$,
  'DF013', null, 'API: a facture cannot be converted from a facture');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('dev_src_draft')) $$,
  'DF013', null, 'API: a facture cannot be converted from a draft devis');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('dev_src_cancelled')) $$,
  'DF013', null, 'API: a facture cannot be converted from a cancelled devis');
select lives_ok(
  $$ update public.documents set converted_from = tests.id('dev_src') where id = tests.id('conv_draft') $$,
  'API: the link can be set on an existing draft facture');
select throws_ok(
  $$ update public.documents set converted_from = tests.id('dev_src_draft') where id = tests.id('conv_draft') $$,
  'DF013', null, 'API: the link cannot be changed to a draft devis');
select throws_ok(
  $$ update public.documents set converted_from = tests.id('conv_draft') where id = tests.id('conv_draft') $$,
  'DF013', null, 'API: a document cannot be converted from itself');
select throws_ok(
  $$ update public.documents set converted_from = tests.id('dev_src') where id = tests.id('conv_devis') $$,
  'DF013', null, 'API: the link cannot be set on a devis');
select throws_ok(
  $$ insert into public.documents (organization_id, type, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('b_sent')) $$,
  '23503', null, 'API: the source must belong to the same organization');
select throws_ok(
  $$ insert into public.documents (organization_id, type, converted_from)
     values (tests.id('org_b'), 'facture', tests.id('b_sent')) $$,
  '42501', 'permission denied', 'API: a document for another organization is refused before its source is examined');
select tests.clear_auth();

-- As superuser.
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('dev_src_draft')) $$,
  'DF013', null, 'superuser: a facture cannot be converted from a draft devis');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('dev_src_cancelled')) $$,
  'DF013', null, 'superuser: a facture cannot be converted from a cancelled devis');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), tests.id('fac_src')) $$,
  'DF013', null, 'superuser: a facture cannot be converted from a facture');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, converted_from)
     values (tests.id('org_a'), 'devis', tests.id('client_a'), tests.id('dev_src')) $$,
  'DF013', null, 'superuser: a devis cannot be converted from anything');
select throws_ok(
  $$ update public.documents set type = 'devis' where id = tests.id('conv_draft') $$,
  'DF013', null, 'superuser: a linked draft facture cannot be turned into a devis');
select throws_ok(
  $$ insert into public.documents (id, organization_id, type, converted_from)
     values ('00000000-0000-4000-8000-000000000001', tests.id('org_a'), 'facture', '00000000-0000-4000-8000-000000000001') $$,
  'DF013', null, 'superuser: a document cannot be inserted as converted from itself');
select throws_ok(
  $$ insert into public.documents (organization_id, type, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('b_sent')) $$,
  '23503', null, 'superuser: the source must belong to the same organization');

-- The rule is checked when the link is made, not forever after: cancelling the devis later
-- must not block the facture that was validly converted from it.
update public.documents set converted_from = tests.id('dev_src_later') where id = tests.id('conv_life');
select lives_ok($$ update public.documents set status = 'cancelled' where id = tests.id('dev_src_later') $$, 'the source devis can be cancelled after a facture was converted from it');
select lives_ok($$ select tests.finalize_as('alice@test.local', tests.id('conv_life')) $$, 'the converted facture can still be finalized');
select lives_ok($$ update public.documents set status = 'paid' where id = tests.id('conv_life') $$, 'and can still be marked paid');
select results_eq(
  $$ select status::text, converted_from from public.documents where id = tests.id('conv_life') $$,
  $$ select 'paid', tests.id('dev_src_later') $$,
  'the converted facture kept its link');

-- =========================================================================================
-- G. AN ISSUED DOCUMENT MUST BE COMPLETE (CHECK documents_issued_is_complete)
-- =========================================================================================
-- A manual draft -> sent passes the trigger, so the CHECK is what stops an incomplete one.
select throws_ok(
  $$ update public.documents set status = 'sent' where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'a bare status = sent, without number or snapshots, is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 800, year = 2022, issue_date = date '2022-01-01',
       seller_name = 's', buyer_name = 'b', retenue_enabled = false where id = tests.id('g_no_client') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing client_id is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 800, year = 2022,
       seller_name = 's', buyer_name = 'b', retenue_enabled = false where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing issue_date is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', year = 2022, issue_date = date '2022-01-01',
       seller_name = 's', buyer_name = 'b', retenue_enabled = false where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing number is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 800, issue_date = date '2022-01-01',
       seller_name = 's', buyer_name = 'b', retenue_enabled = false where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing year is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 800, year = 2022, issue_date = date '2022-01-01',
       buyer_name = 'b', retenue_enabled = false where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing seller_name is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 800, year = 2022, issue_date = date '2022-01-01',
       seller_name = 's', retenue_enabled = false where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing buyer_name is rejected');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 800, year = 2022, issue_date = date '2022-01-01',
       seller_name = 's', buyer_name = 'b' where id = tests.id('g_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'missing retenue_enabled is rejected');
select lives_ok(
  $$ update public.documents set status = 'sent', number = 800, year = 2022, issue_date = date '2022-01-01',
       seller_name = 's', buyer_name = 'b', retenue_enabled = false where id = tests.id('g_draft') $$,
  'with all seven fields present the same update is accepted');
select throws_ok(
  $$ insert into public.documents (organization_id, type, status, number, year)
     values (tests.id('org_a'), 'facture', 'sent', 801, 2022) $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'an incomplete document cannot be inserted directly as sent either');

select * from finish();
rollback;
