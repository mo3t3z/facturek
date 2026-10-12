-- Structural guarantees: these fail if a future migration forgets RLS or over-grants.
begin;
select * from no_plan();

select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'RLS is enabled on every table in public'
);

select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'document_counters'
       and not exists (
         select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
       ) $$,
  'every public table except document_counters has at least one policy'
);

-- document_counters is the one table with no policy at all: nothing can reach it from the API.
select is_empty(
  $$ select policyname::text from pg_policies
     where schemaname = 'public' and tablename = 'document_counters' $$,
  'document_counters has no policy'
);
select is_empty(
  $$ select r.rolname, p.privilege
     from (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
     cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (privilege)
     where has_table_privilege(r.rolname, 'public.document_counters', p.privilege)
        or (p.privilege in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            and has_any_column_privilege(r.rolname, 'public.document_counters', p.privilege)) $$,
  'anon, authenticated and service_role have no privilege of any kind on document_counters'
);

-- Guard triggers: present, enabled, and their functions callable by no API role.
select bag_eq(
  $$ select c.relname::text, t.tgname::text
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
       and c.relname in ('documents', 'document_items', 'payments') $$,
  $$ values ('documents', 'guard_documents'),
            ('documents', 'guard_document_conversion'),
            ('documents', 'set_updated_at'),
            ('document_items', 'guard_document_items'),
            ('document_items', 'set_updated_at'),
            ('payments', 'guard_payments') $$,
  'documents, document_items and payments carry exactly the expected triggers'
);
select is_empty(
  $$ select c.relname::text, t.tgname::text
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'O' $$,
  'no trigger in public is disabled'
);
select is_empty(
  $$ select p.proname::text, r.rolname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
     where n.nspname = 'private' and p.prorettype = 'trigger'::regtype
       and has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  'no API role can execute a trigger function directly'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.prosecdef
     and p.proname in ('guard_documents', 'guard_document_conversion', 'guard_document_items', 'guard_payments')),
  4, 'the four document guard functions are SECURITY DEFINER'
);

select is_empty(
  $$ select tablename::text, policyname::text from pg_policies
     where schemaname = 'public' and not (roles = '{authenticated}') $$,
  'every policy targets the authenticated role only'
);

select is_empty(
  $$ select table_name::text, privilege_type::text from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'PUBLIC') $$,
  'anon and PUBLIC have no table privileges in public'
);

select is_empty(
  $$ select table_name::text, column_name::text from information_schema.column_privileges
     where table_schema = 'public' and grantee in ('anon', 'PUBLIC') $$,
  'anon and PUBLIC have no column privileges in public'
);

-- Column privileges: identity columns are not writable by the API role.
select ok(
  not has_column_privilege('authenticated', 'public.organization_members', 'organization_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.organization_members', 'user_id', 'UPDATE'),
  'authenticated cannot UPDATE the keys of organization_members'
);
select ok(
  not has_column_privilege('authenticated', 'public.clients', 'organization_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.clients', 'id', 'UPDATE'),
  'authenticated cannot UPDATE id or organization_id of clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.organizations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organizations', 'DELETE'),
  'authenticated cannot INSERT or DELETE organizations'
);
select ok(
  not has_table_privilege('authenticated', 'public.organization_members', 'INSERT'),
  'authenticated has no INSERT privilege on organization_members'
);
select is_empty(
  $$ select policyname::text from pg_policies
     where schemaname = 'public' and tablename = 'organization_members' and cmd in ('INSERT', 'ALL') $$,
  'organization_members has no INSERT policy'
);
select bag_eq(
  $$ select c.column_name::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'tax_settings'
       and has_column_privilege('authenticated', 'public.tax_settings', c.column_name, 'UPDATE') $$,
  $$ values ('default_tva_rate'), ('timbre_enabled'), ('timbre_fiscal'), ('retenue_enabled'), ('retenue_rate'), ('retenue_threshold') $$,
  'authenticated can UPDATE only the editable columns of tax_settings (not organization_id)'
);
select ok(
  not has_table_privilege('authenticated', 'public.tax_settings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tax_settings', 'DELETE'),
  'authenticated cannot INSERT or DELETE tax_settings'
);

-- documents: exact column privileges of the API role (first line of defence around
-- status and numbering).
select bag_eq(
  $$ select c.column_name::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'documents'
       and has_column_privilege('authenticated', 'public.documents', c.column_name, 'INSERT') $$,
  $$ values ('organization_id'), ('type'), ('client_id'), ('issue_date'), ('due_date'), ('notes'), ('converted_from') $$,
  'authenticated can INSERT only content columns of documents (no status, number, year)'
);
select bag_eq(
  $$ select c.column_name::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'documents'
       and has_column_privilege('authenticated', 'public.documents', c.column_name, 'UPDATE') $$,
  $$ values ('client_id'), ('issue_date'), ('due_date'), ('notes'), ('converted_from') $$,
  'authenticated can UPDATE only content columns of documents (no status, number, year, id, organization_id)'
);
-- The two tests above already prove it (exact lists); this one names the snapshot columns
-- so that a future GRANT on any of them fails with an obvious message.
select is_empty(
  $$ select c.column_name::text, p.privilege
     from information_schema.columns c
     cross join (values ('INSERT'), ('UPDATE')) p (privilege)
     where c.table_schema = 'public' and c.table_name = 'documents'
       and c.column_name in (
         'seller_name', 'seller_matricule_fiscal', 'seller_address',
         'buyer_name', 'buyer_matricule_fiscal', 'buyer_address',
         'timbre_fiscal', 'retenue_enabled', 'retenue_rate', 'retenue_threshold'
       )
       and has_column_privilege('authenticated', 'public.documents', c.column_name, p.privilege) $$,
  'authenticated can neither INSERT nor UPDATE any snapshot column of documents'
);
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'documents'
     and column_name in (
       'seller_name', 'seller_matricule_fiscal', 'seller_address',
       'buyer_name', 'buyer_matricule_fiscal', 'buyer_address',
       'timbre_fiscal', 'retenue_enabled', 'retenue_rate', 'retenue_threshold'
     )),
  10, 'documents has the 10 snapshot columns'
);
select bag_eq(
  $$ select c.column_name::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'document_items'
       and has_column_privilege('authenticated', 'public.document_items', c.column_name, 'UPDATE') $$,
  $$ values ('position'), ('description'), ('quantity'), ('unit_price'), ('tva_rate') $$,
  'authenticated cannot UPDATE id, organization_id or document_id of document_items'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.payments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.payments', 'DELETE'),
  'authenticated has no UPDATE or DELETE privilege on payments'
);
select is_empty(
  $$ select table_name::text, column_name::text from information_schema.columns
     where table_schema = 'public' and column_name like '%tva%' and column_default is not null $$,
  'no TVA rate column has a default'
);

-- SECURITY DEFINER hygiene.
select is_empty(
  $$ select p.proname::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not (coalesce(p.proconfig, '{}') @> array['search_path=""']) $$,
  'every SECURITY DEFINER function pins search_path to empty'
);
select is_empty(
  $$ select n.nspname::text, p.proname::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon (and therefore PUBLIC) can execute no function in public or private'
);
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no usage on schema private');
select bag_eq(
  $$ select p.proname::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  $$ values ('is_org_member'), ('has_org_role'), ('shares_org_with') $$,
  'authenticated can execute exactly the three RLS helpers in private'
);
-- The RPC surface: the complete list of functions the API role can call.
select bag_eq(
  $$ select p.proname::text
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  $$ values ('finalize_document') $$,
  'authenticated can execute exactly one function in public: finalize_document'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_document(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.finalize_document(uuid)', 'EXECUTE'),
  'neither anon nor service_role can execute finalize_document'
);
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.finalize_document(uuid)'::regprocedure),
  true, 'finalize_document is SECURITY DEFINER'
);

-- No tax value is assumed by the schema.
select is_empty(
  $$ select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'tax_settings'
       and column_name in ('default_tva_rate', 'timbre_fiscal', 'retenue_rate', 'retenue_threshold')
       and column_default is not null $$,
  'tax_settings has no default rate or amount'
);

-- Behaviour as anon.
select tests.seed();
select tests.create_draft('doc_a', tests.id('org_a'), tests.id('client_a'));
select tests.authenticate_as_anon();

select throws_ok('select * from public.organizations', '42501', null, 'anon cannot read organizations');
select throws_ok('select * from public.organization_members', '42501', null, 'anon cannot read organization_members');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.clients', '42501', null, 'anon cannot read clients');
select throws_ok('select * from public.tax_settings', '42501', null, 'anon cannot read tax_settings');
select throws_ok(
  $$ insert into public.clients (organization_id, name) values (tests.id('org_a'), 'x') $$,
  '42501', null, 'anon cannot insert clients'
);
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values (tests.id('org_a'), tests.id('user:bob@test.local'), 'member') $$,
  '42501', null, 'anon cannot insert a membership'
);
select throws_ok('select * from public.documents', '42501', null, 'anon cannot read documents');
select throws_ok('select * from public.document_items', '42501', null, 'anon cannot read document_items');
select throws_ok('select * from public.payments', '42501', null, 'anon cannot read payments');
select throws_ok(
  $$ insert into public.documents (organization_id, type) values (tests.id('org_a'), 'facture') $$,
  '42501', null, 'anon cannot insert documents'
);
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('doc_a'), 'x', 1, 1, 0) $$,
  '42501', null, 'anon cannot insert document_items'
);
select throws_ok(
  $$ insert into public.payments (organization_id, document_id, amount, paid_at, method)
     values (tests.id('org_a'), tests.id('doc_a'), 1, current_date, 'cash') $$,
  '42501', null, 'anon cannot insert payments'
);
select throws_ok($$ update public.documents set notes = 'x' $$, '42501', null, 'anon cannot update documents');
select throws_ok('delete from public.documents', '42501', null, 'anon cannot delete documents');
select throws_ok('delete from public.document_items', '42501', null, 'anon cannot delete document_items');
select throws_ok(
  $$ update public.tax_settings set timbre_fiscal = 0 $$,
  '42501', null, 'anon cannot update tax_settings'
);
select throws_ok(
  $$ select public.finalize_document(tests.id('doc_a')) $$,
  '42501', null, 'anon cannot call finalize_document'
);
select throws_ok('select * from public.document_counters', '42501', null, 'anon cannot read document_counters');
select throws_ok(
  $$ insert into public.document_counters (organization_id, type, year, last_number)
     values (tests.id('org_a'), 'facture', 2026, 99) $$,
  '42501', null, 'anon cannot write document_counters'
);

select tests.clear_auth();
select * from finish();
rollback;
