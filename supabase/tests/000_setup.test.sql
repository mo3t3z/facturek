-- Runs first (alphabetical order) and is NOT wrapped in a transaction: it installs the
-- shared test helpers in a `tests` schema of the LOCAL database. Every other test file runs
-- inside begin/rollback, so no test data is ever left behind.
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Named ids created by tests.seed() (rows only exist inside a test transaction).
create table if not exists tests.fixtures (
  key text primary key,
  id uuid not null
);
grant select on tests.fixtures to anon, authenticated;

create or replace function tests.id(p_key text)
returns uuid
language plpgsql
-- Deliberately VOLATILE: a STABLE function can be evaluated by the planner with a snapshot
-- taken before the fixture rows of the current transaction were inserted.
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select f.id into strict v_id from tests.fixtures f where f.key = p_key;
  return v_id;
end;
$$;

create or replace function tests.remember(p_key text, p_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into tests.fixtures (key, id) values (p_key, p_id)
  on conflict (key) do update set id = excluded.id
  returning id;
$$;

-- Creates an auth user plus what an account needs: profile, organization (user = owner)
-- and an empty tax_settings row. Remembers 'user:<email>' and, if given, p_org_key.
create or replace function tests.create_user(
  p_email text,
  p_organization_name text,
  p_org_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_org_id uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', p_email, '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );
  perform tests.remember('user:' || p_email, v_user_id);

  insert into public.profiles (id, full_name) values (v_user_id, split_part(p_email, '@', 1));
  insert into public.organizations (name) values (p_organization_name) returning id into v_org_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');
  insert into public.tax_settings (organization_id) values (v_org_id);

  if p_org_key is not null then
    perform tests.remember(p_org_key, v_org_id);
  end if;
  return v_user_id;
end;
$$;

-- Impersonation: same role + JWT claims PostgREST sets for a real request.
create or replace function tests.authenticate_as(p_email text)
returns void
language plpgsql
as $$
declare
  v_id uuid := tests.id('user:' || p_email);
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'email', p_email)::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- A draft document with one item. Remembers p_key and p_key || ':item'.
create or replace function tests.create_draft(
  p_key text,
  p_org uuid,
  p_client uuid,
  p_type public.document_type default 'facture'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid;
  v_item uuid;
begin
  insert into public.documents (organization_id, type, client_id)
  values (p_org, p_type, p_client)
  returning id into v_doc;

  insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
  values (p_org, v_doc, 'Prestation', 1, 100.000, 0)
  returning id into v_item;

  perform tests.remember(p_key, v_doc);
  perform tests.remember(p_key || ':item', v_item);
  return v_doc;
end;
$$;

-- Standard world used by the test files:
--   org_a: alice (owner), carol (admin), dave (member)      org_b: bob (owner)
-- carol and dave also own a personal organization of their own.
create or replace function tests.seed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client uuid;
begin
  perform tests.create_user('alice@test.local', 'Org A', 'org_a');
  perform tests.create_user('bob@test.local', 'Org B', 'org_b');
  perform tests.create_user('carol@test.local', 'Carol solo');
  perform tests.create_user('dave@test.local', 'Dave solo');

  insert into public.organization_members (organization_id, user_id, role)
  values
    (tests.id('org_a'), tests.id('user:carol@test.local'), 'admin'),
    (tests.id('org_a'), tests.id('user:dave@test.local'), 'member');

  -- Arbitrary TEST value, not a real tax amount.
  update public.tax_settings set timbre_fiscal = 9.999
  where organization_id in (tests.id('org_a'), tests.id('org_b'));

  insert into public.clients (organization_id, name) values (tests.id('org_a'), 'Client A')
  returning id into v_client;
  perform tests.remember('client_a', v_client);

  insert into public.clients (organization_id, name) values (tests.id('org_b'), 'Client B')
  returning id into v_client;
  perform tests.remember('client_b', v_client);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select has_schema('tests', 'test helpers are installed');
select * from finish();
