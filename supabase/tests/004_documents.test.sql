-- documents, document_items, payments: tenant isolation, same-org foreign keys, column
-- privileges around status/number/year, and the draft-only rules.
begin;
select * from no_plan();

select tests.seed();

-- Fixtures (as superuser). "Sent" documents are created by hand here because
-- finalize_document() does not exist yet; the API role cannot produce this state.
select tests.create_draft('doc_a', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('doc_a_other', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('doc_a_sent', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('doc_b', tests.id('org_b'), tests.id('client_b'));
select tests.create_draft('doc_b_sent', tests.id('org_b'), tests.id('client_b'));
update public.documents set status = 'sent', number = 1, year = 2026
where id in (tests.id('doc_a_sent'), tests.id('doc_b_sent'));
-- A sent document WITHOUT payments: nothing but the delete policy protects it from deletion.
select tests.create_draft('doc_a_sent_unpaid', tests.id('org_a'), tests.id('client_a'));
update public.documents set status = 'sent', number = 2, year = 2026 where id = tests.id('doc_a_sent_unpaid');
insert into public.payments (organization_id, document_id, amount, paid_at, method)
values (tests.id('org_b'), tests.id('doc_b_sent'), 10.000, current_date, 'cash')
returning tests.remember('payment_b', id);
insert into public.payments (organization_id, document_id, amount, paid_at, method)
values (tests.id('org_a'), tests.id('doc_a_sent'), 20.000, current_date, 'cheque')
returning tests.remember('payment_a', id);
insert into public.clients (organization_id, name) values (tests.id('org_a'), 'Unused client')
returning tests.remember('client_a_unused', id);

select tests.authenticate_as('alice@test.local');

-- 1. CROSS-ORG ISOLATION: READ -----------------------------------------------------------
select is_empty($$ select 1 from public.documents where organization_id = tests.id('org_b') $$, 'A cannot read B''s documents');
select is_empty($$ select 1 from public.document_items where organization_id = tests.id('org_b') $$, 'A cannot read B''s items');
select is_empty($$ select 1 from public.payments where organization_id = tests.id('org_b') $$, 'A cannot read B''s payments');
select is((select count(*)::int from public.documents), 4, 'A reads exactly their own 4 documents');
select is((select count(*)::int from public.document_items), 4, 'A reads exactly their own 4 items');
select is((select count(*)::int from public.payments), 1, 'A reads exactly their own payment');

-- 2. CROSS-ORG ISOLATION: WRITE ----------------------------------------------------------
select throws_ok(
  $$ insert into public.documents (organization_id, type) values (tests.id('org_b'), 'facture') $$,
  '42501', null, 'A cannot insert a document into B');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_b'), tests.id('doc_b'), 'x', 1, 1, 0) $$,
  '42501', null, 'A cannot insert an item into B''s document');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_b'), tests.id('doc_b_sent'), 1, current_date, 'cash') $$,
  '42501', null, 'A cannot insert a payment into B');

select is_empty($$ update public.documents set notes = 'hacked' where organization_id = tests.id('org_b') returning 1 $$, 'A cannot update B''s documents');
select is_empty($$ update public.document_items set description = 'hacked' where organization_id = tests.id('org_b') returning 1 $$, 'A cannot update B''s items');
select is_empty($$ delete from public.documents where organization_id = tests.id('org_b') returning 1 $$, 'A cannot delete B''s documents');
select is_empty($$ delete from public.document_items where organization_id = tests.id('org_b') returning 1 $$, 'A cannot delete B''s items');

-- 3. SAME-ORG FOREIGN KEYS, through the API ----------------------------------------------
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id)
     values (tests.id('org_a'), 'facture', tests.id('client_b')) $$,
  '23503', null, 'a new document cannot reference another org''s client');
select throws_ok(
  $$ update public.documents set client_id = tests.id('client_b') where id = tests.id('doc_a') $$,
  '23503', null, 'an existing document cannot be pointed at another org''s client');
select throws_ok(
  $$ insert into public.documents (organization_id, type, converted_from)
     values (tests.id('org_a'), 'facture', tests.id('doc_b')) $$,
  '23503', null, 'a document cannot be converted from another org''s document');
select throws_ok(
  $$ update public.documents set converted_from = tests.id('doc_b') where id = tests.id('doc_a') $$,
  '23503', null, 'converted_from cannot be pointed at another org''s document');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_b'), 'x', 1, 1, 0) $$,
  '42501', null, 'an item cannot be attached to another org''s document by lying about organization_id');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('doc_b_sent'), 1, current_date, 'cash') $$,
  '23503', null, 'a payment cannot be attached to another org''s document by lying about organization_id');
select throws_ok(
  $$ delete from public.clients where id = tests.id('client_a') $$,
  '23503', null, 'a client referenced by a document cannot be deleted');
select isnt_empty(
  $$ delete from public.clients where id = tests.id('client_a_unused') returning 1 $$,
  'a client that no document references can still be deleted');

-- 4. STATUS / NUMBER / YEAR are out of reach of the API role ------------------------------
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, status)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), 'sent') $$,
  '42501', null, 'cannot insert a document with status = sent');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, status)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), 'draft') $$,
  '42501', null, 'cannot even name status in an INSERT');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, number, year)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), 1, 2026) $$,
  '42501', null, 'cannot insert a document with a number and year');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, status, number, year)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), 'sent', 5, 2026) $$,
  '42501', null, 'cannot insert a fully formed sent document');
select throws_ok($$ update public.documents set status = 'sent' where id = tests.id('doc_a') $$, '42501', null, 'cannot update status directly');
select throws_ok($$ update public.documents set status = 'paid' where id = tests.id('doc_a_sent') $$, '42501', null, 'cannot mark a sent document paid directly');
select throws_ok($$ update public.documents set status = 'draft' where id = tests.id('doc_a_sent') $$, '42501', null, 'cannot move a sent document back to draft');
select throws_ok($$ update public.documents set number = 7 where id = tests.id('doc_a') $$, '42501', null, 'cannot update number directly');
select throws_ok($$ update public.documents set year = 2020 where id = tests.id('doc_a') $$, '42501', null, 'cannot update year directly');
select throws_ok($$ update public.documents set number = 7, year = 2026, status = 'sent' where id = tests.id('doc_a') $$, '42501', null, 'cannot number and send a document in one UPDATE');
select throws_ok($$ update public.documents set organization_id = tests.id('org_b') where id = tests.id('doc_a') $$, '42501', null, 'cannot update organization_id of a document');
select throws_ok($$ update public.documents set id = gen_random_uuid() where id = tests.id('doc_a') $$, '42501', null, 'cannot update id of a document');
select throws_ok($$ update public.documents set type = 'devis' where id = tests.id('doc_a') $$, '42501', null, 'cannot update type of a document');
select throws_ok($$ update public.documents set currency = 'EUR' where id = tests.id('doc_a') $$, '42501', null, 'cannot update currency of a document');
select throws_ok($$ update public.document_items set organization_id = tests.id('org_b') where id = tests.id('doc_a:item') $$, '42501', null, 'cannot update organization_id of an item');
select throws_ok($$ update public.document_items set document_id = tests.id('doc_a_sent') where id = tests.id('doc_a:item') $$, '42501', null, 'cannot move an item to another document');

-- What a member CAN do with a draft.
select lives_ok(
  $$ insert into public.documents (organization_id, type, client_id, issue_date, due_date, notes)
     values (tests.id('org_a'), 'devis', tests.id('client_a'), date '2026-10-01', date '2026-10-31', 'made by the API role') $$,
  'a member can create a draft with content columns');
select results_eq(
  $$ select status::text, number, year, currency from public.documents where notes = 'made by the API role' $$,
  $$ values ('draft', null::int, null::int, 'TND') $$,
  'a new document is a draft without number or year, in TND');
select isnt_empty(
  $$ update public.documents set notes = 'edited', due_date = date '2026-12-31' where id = tests.id('doc_a') returning 1 $$,
  'a member can edit the content of a draft');
select lives_ok(
  $$ update public.documents set converted_from = tests.id('doc_a_other') where id = tests.id('doc_a') $$,
  'converted_from can reference a document of the same organization');

-- 5. DRAFT-ONLY RULES ---------------------------------------------------------------------
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a_sent'), 'sneaky', 1, 1, 0) $$,
  '42501', null, 'an item cannot be added to a non-draft document');
select is_empty(
  $$ update public.document_items set unit_price = 1 where id = tests.id('doc_a_sent:item') returning 1 $$,
  'an item of a non-draft document cannot be updated');
select is_empty(
  $$ delete from public.document_items where id = tests.id('doc_a_sent:item') returning 1 $$,
  'an item of a non-draft document cannot be deleted');
select is_empty(
  $$ delete from public.documents where id = tests.id('doc_a_sent_unpaid') returning 1 $$,
  'a non-draft document cannot be deleted from the API');
select isnt_empty($$ select 1 from public.documents where id = tests.id('doc_a_sent_unpaid') $$,'the non-draft document still exists');
select isnt_empty($$ select 1 from public.document_items where id = tests.id('doc_a_sent:item') $$, 'the item of the non-draft document is still readable');

select lives_ok(
  $$ insert into public.document_items (organization_id, document_id, position, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a'), 1, 'Second line', 2.500, 40.125, 0) $$,
  'an item can be added to a draft');
select isnt_empty(
  $$ update public.document_items set quantity = 3 where id = tests.id('doc_a:item') returning 1 $$,
  'an item of a draft can be updated');
select isnt_empty(
  $$ delete from public.document_items where document_id = tests.id('doc_a') and description = 'Second line' returning 1 $$,
  'an item of a draft can be deleted');
select throws_ok(
  $$ delete from public.documents where id = tests.id('doc_a_other') $$,
  '23503', null, 'a document that another document was converted from cannot be deleted');
select lives_ok(
  $$ update public.documents set converted_from = null where id = tests.id('doc_a') $$,
  'converted_from can be cleared on a draft');
select isnt_empty(
  $$ delete from public.documents where id = tests.id('doc_a_other') returning 1 $$,
  'a draft document can be deleted');
select is_empty(
  $$ select 1 from public.document_items where id = tests.id('doc_a_other:item') $$,
  'deleting a draft deletes its items');

-- 6. PAYMENTS are append-only from the API ------------------------------------------------
select lives_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('doc_a_sent'), 50.500, current_date, 'virement') $$,
  'a member can record a payment');
select throws_ok($$ update public.payments set amount = 1 where id = tests.id('payment_a') $$, '42501', null, 'a payment cannot be updated from the API');
select throws_ok($$ delete from public.payments where id = tests.id('payment_a') $$, '42501', null, 'a payment cannot be deleted from the API');
select throws_ok($$ delete from public.payments where id = tests.id('payment_b') $$, '42501', null, 'another org''s payment cannot be deleted either');

-- 7. DATA VALIDITY ------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a'), 'x', 0, 1, 0) $$,
  '23514', null, 'quantity must be > 0');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a'), 'x', 1, -0.001, 0) $$,
  '23514', null, 'unit_price must be >= 0');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a'), 'x', 1, 1, 100.001) $$,
  '23514', null, 'tva_rate must be <= 100');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a'), 'x', 1, 1, -1) $$,
  '23514', null, 'tva_rate must be >= 0');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price)
     values (tests.id('org_a'), tests.id('doc_a'), 'x', 1, 1) $$,
  '23502', null, 'tva_rate has no default and must be given');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('doc_a_sent'), 0, current_date, 'cash') $$,
  '23514', null, 'payment amount must be > 0');
select throws_ok(
  $$ update public.documents set issue_date = date '2026-10-10', due_date = date '2026-10-01' where id = tests.id('doc_a') $$,
  '23514', null, 'due_date cannot be before issue_date');

-- 8. SAME-ORG MEMBER ----------------------------------------------------------------------
select tests.authenticate_as('dave@test.local');
select isnt_empty($$ select 1 from public.documents where id = tests.id('doc_a') $$, 'a plain member reads the org''s documents');
select isnt_empty($$ select 1 from public.payments where id = tests.id('payment_a') $$, 'a plain member reads the org''s payments');
select lives_ok(
  $$ insert into public.documents (organization_id, type, client_id) values (tests.id('org_a'), 'facture', tests.id('client_a')) $$,
  'a plain member can create a draft');
select is_empty($$ select 1 from public.documents where organization_id = tests.id('org_b') $$, 'a plain member of A cannot read B''s documents');

-- 9. BELOW THE API: constraints hold for every role ---------------------------------------
select tests.clear_auth();
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_b'), 'x', 1, 1, 0) $$,
  '23503', null, 'FK: an item''s organization must be its document''s organization');
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('doc_b_sent'), 1, current_date, 'cash') $$,
  '23503', null, 'FK: a payment''s organization must be its document''s organization');
select throws_ok(
  $$ update public.documents set client_id = tests.id('client_b') where id = tests.id('doc_a') $$,
  '23503', null, 'FK: a document''s client must be in the document''s organization');
select throws_ok(
  $$ update public.documents set organization_id = tests.id('org_b') where id = tests.id('doc_a') $$,
  '23503', null, 'FK: a document cannot change organization while it has a client, items or payments');
select throws_ok(
  $$ update public.documents set status = 'sent' where id = tests.id('doc_a') $$,
  '23514', null, 'CHECK: a document cannot leave draft without a number');
select throws_ok(
  $$ update public.documents set number = 9 where id = tests.id('doc_a') $$,
  '23514', null, 'CHECK: number and year go together');
select throws_ok(
  $$ update public.documents set number = 0, year = 2026 where id = tests.id('doc_a') $$,
  '23514', null, 'CHECK: number must be positive');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 1, year = 2026 where id = tests.id('doc_a') $$,
  '23505', null, 'UNIQUE: two documents of one org/type/year cannot share a number');
select lives_ok(
  $$ update public.documents set status = 'sent', number = 3, year = 2026 where id = tests.id('doc_a') $$,
  'UNIQUE: the next number is accepted');
select throws_ok(
  $$ delete from public.documents where id = tests.id('doc_a_sent') $$,
  '23503', null, 'FK: a document with payments cannot be deleted');

-- Ground truth: B is untouched.
select results_eq(
  $$ select count(*)::int, count(*) filter (where notes is not null)::int from public.documents where organization_id = tests.id('org_b') $$,
  $$ values (2, 0) $$, 'B still has its 2 documents, unmodified');
select is((select count(*)::int from public.document_items where organization_id = tests.id('org_b')), 2, 'B still has its 2 items');
select is((select count(*)::int from public.payments where organization_id = tests.id('org_b')), 1, 'B still has its 1 payment');
select is((select amount from public.payments where id = tests.id('payment_a')), 20.000, 'A''s existing payment is unchanged');

select * from finish();
rollback;
