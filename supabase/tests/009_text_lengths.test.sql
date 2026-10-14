-- Length limits of the free-text columns: each one exists with the limit of its screen,
-- the limit itself is accepted and one character more is refused (23514), for every role.
begin;
select * from no_plan();

select tests.seed();

-- Every limit, as pg_get_constraintdef prints it. A missing or different one fails here.
select set_eq(
  $$ select conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid)
     from pg_constraint
     where contype = 'c' and connamespace = 'public'::regnamespace and conname like '%\_length' $$,
  $$ values
     ('organizations.organizations_name_length CHECK ((length(name) <= 200))'),
     ('organizations.organizations_matricule_fiscal_length CHECK ((length(matricule_fiscal) <= 50))'),
     ('organizations.organizations_address_length CHECK ((length(address) <= 500))'),
     ('organizations.organizations_email_length CHECK ((length(email) <= 254))'),
     ('organizations.organizations_phone_length CHECK ((length(phone) <= 30))'),
     ('clients.clients_name_length CHECK ((length(name) <= 200))'),
     ('clients.clients_matricule_fiscal_length CHECK ((length(matricule_fiscal) <= 50))'),
     ('clients.clients_address_length CHECK ((length(address) <= 500))'),
     ('clients.clients_email_length CHECK ((length(email) <= 254))'),
     ('clients.clients_phone_length CHECK ((length(phone) <= 30))'),
     ('documents.documents_notes_length CHECK ((length(notes) <= 2000))'),
     ('documents.documents_seller_name_length CHECK ((length(seller_name) <= 200))'),
     ('documents.documents_seller_matricule_fiscal_length CHECK ((length(seller_matricule_fiscal) <= 50))'),
     ('documents.documents_seller_address_length CHECK ((length(seller_address) <= 500))'),
     ('documents.documents_buyer_name_length CHECK ((length(buyer_name) <= 200))'),
     ('documents.documents_buyer_matricule_fiscal_length CHECK ((length(buyer_matricule_fiscal) <= 50))'),
     ('documents.documents_buyer_address_length CHECK ((length(buyer_address) <= 500))'),
     ('profiles.profiles_full_name_length CHECK ((length(full_name) <= 100))'),
     ('document_items.document_items_description_length CHECK ((length(description) <= 500))') $$,
  'every free-text column has its length limit, the same as its screen'
);

-- As superuser (the CHECKs bind every role): the limit passes, one more is refused.
select lives_ok(
  $$ update public.clients set name = repeat('n', 200), matricule_fiscal = repeat('m', 50),
       address = repeat('a', 500), email = repeat('e', 254), phone = repeat('9', 30)
     where id = tests.id('client_a') $$,
  'a client at every limit is accepted'
);
select throws_ok($$ update public.clients set name = repeat('n', 201) where id = tests.id('client_a') $$, '23514', null, 'client name of 201 is refused');
select throws_ok($$ update public.clients set phone = repeat('9', 31) where id = tests.id('client_a') $$, '23514', null, 'client phone of 31 is refused');
select throws_ok($$ update public.organizations set address = repeat('a', 501) where id = tests.id('org_a') $$, '23514', null, 'organization address of 501 is refused');
select throws_ok($$ update public.organizations set matricule_fiscal = repeat('m', 51) where id = tests.id('org_a') $$, '23514', null, 'organization matricule of 51 is refused');

select tests.create_draft('doc_len', tests.id('org_a'), tests.id('client_a'));
select lives_ok($$ update public.documents set notes = repeat('x', 2000) where id = tests.id('doc_len') $$, 'notes of 2000 are accepted');
select throws_ok($$ update public.documents set notes = repeat('x', 2001) where id = tests.id('doc_len') $$, '23514', null, 'notes of 2001 are refused');

-- Characters, not bytes: 200 two-byte characters fit.
select lives_ok($$ update public.clients set name = repeat('é', 200) where id = tests.id('client_a') $$, 'the limit counts characters, not bytes');

-- Through the API role, the same refusal.
select tests.authenticate_as('alice@test.local');
select throws_ok($$ update public.clients set email = repeat('e', 255) where id = tests.id('client_a') $$, '23514', null, 'the API role is refused too');
select tests.clear_auth();

select * from finish();
rollback;
