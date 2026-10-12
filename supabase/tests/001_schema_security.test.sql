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
     where n.nspname = 'public' and c.relkind = 'r'
       and not exists (
         select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
       ) $$,
  'every public table has at least one policy'
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
select ok(
  not has_table_privilege('authenticated', 'public.tax_settings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tax_settings', 'DELETE'),
  'authenticated cannot INSERT or DELETE tax_settings'
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
select throws_ok(
  $$ update public.tax_settings set timbre_fiscal = 0 $$,
  '42501', null, 'anon cannot update tax_settings'
);

select tests.clear_auth();
select * from finish();
rollback;
