-- User A (alice, org_a) must not be able to read or write anything in org_b (bob).
begin;
select * from no_plan();

select tests.seed();
select tests.authenticate_as('alice@test.local');

-- READ ----------------------------------------------------------------------------------
select is_empty($$ select 1 from public.organizations where id = tests.id('org_b') $$, 'A cannot read B''s organization');
select is_empty($$ select 1 from public.organization_members where organization_id = tests.id('org_b') $$, 'A cannot read B''s members');
select is_empty($$ select 1 from public.profiles where id = tests.id('user:bob@test.local') $$, 'A cannot read B''s profile');
select is_empty($$ select 1 from public.clients where organization_id = tests.id('org_b') $$, 'A cannot read B''s clients');
select is_empty($$ select 1 from public.tax_settings where organization_id = tests.id('org_b') $$, 'A cannot read B''s tax settings');

-- A still sees their own data (the policies are not simply "deny all").
select is((select count(*)::int from public.organizations), 1, 'A sees exactly one organization: their own');
select isnt_empty($$ select 1 from public.clients where organization_id = tests.id('org_a') $$, 'A reads own clients');
select isnt_empty($$ select 1 from public.tax_settings where organization_id = tests.id('org_a') $$, 'A reads own tax settings');
select isnt_empty($$ select 1 from public.profiles where id = tests.id('user:alice@test.local') $$, 'A reads own profile');

-- INSERT --------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.clients (organization_id, name) values (tests.id('org_b'), 'intruder') $$,
  '42501', null, 'A cannot insert a client into B');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values (tests.id('org_b'), tests.id('user:alice@test.local'), 'owner') $$,
  '42501', null, 'A cannot add themselves to B as owner');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values (tests.id('org_b'), tests.id('user:alice@test.local'), 'member') $$,
  '42501', null, 'A cannot add themselves to B as member');
select throws_ok(
  $$ insert into public.organizations (name) values ('rogue org') $$,
  '42501', null, 'organizations cannot be inserted from the API');
select throws_ok(
  $$ insert into public.tax_settings (organization_id) values (tests.id('org_b')) $$,
  '42501', null, 'tax_settings cannot be inserted from the API');
select throws_ok(
  $$ insert into public.profiles (id, full_name) values (gen_random_uuid(), 'ghost') $$,
  '42501', null, 'profiles cannot be inserted from the API');

-- UPDATE / DELETE: RLS hides the rows, so the statements affect nothing --------------------
select is_empty($$ update public.organizations set name = 'hacked' where id = tests.id('org_b') returning 1 $$, 'A cannot update B''s organization');
select is_empty($$ update public.clients set name = 'hacked' where organization_id = tests.id('org_b') returning 1 $$, 'A cannot update B''s clients');
select is_empty($$ update public.tax_settings set timbre_fiscal = 0 where organization_id = tests.id('org_b') returning 1 $$, 'A cannot update B''s tax settings');
select is_empty($$ update public.organization_members set role = 'member' where organization_id = tests.id('org_b') returning 1 $$, 'A cannot update B''s members');
select is_empty($$ update public.profiles set full_name = 'hacked' where id = tests.id('user:bob@test.local') returning 1 $$, 'A cannot update B''s profile');
select throws_ok(
  $$ update public.clients set organization_id = tests.id('org_a') where id = tests.id('client_b') $$,
  '42501', null, 'A cannot pull B''s client into their own organization');

select is_empty($$ delete from public.clients where organization_id = tests.id('org_b') returning 1 $$, 'A cannot delete B''s clients');
select is_empty($$ delete from public.organization_members where organization_id = tests.id('org_b') returning 1 $$, 'A cannot delete B''s members');
select throws_ok($$ delete from public.organizations where id = tests.id('org_b') $$, '42501', null, 'organizations cannot be deleted from the API');
select throws_ok($$ delete from public.tax_settings where organization_id = tests.id('org_b') $$, '42501', null, 'tax_settings cannot be deleted from the API');

-- Ground truth, checked without RLS: nothing in B changed -------------------------------
select tests.clear_auth();
select is((select name from public.organizations where id = tests.id('org_b')), 'Org B', 'B''s organization is untouched');
select is((select name from public.clients where id = tests.id('client_b')), 'Client B', 'B''s client is untouched');
select is((select organization_id from public.clients where id = tests.id('client_b')), tests.id('org_b'), 'B''s client is still in B');
select is((select timbre_fiscal from public.tax_settings where organization_id = tests.id('org_b')), 9.999, 'B''s tax settings are untouched');
select is((select full_name from public.profiles where id = tests.id('user:bob@test.local')), 'bob', 'B''s profile is untouched');
select results_eq(
  $$ select user_id, role::text from public.organization_members where organization_id = tests.id('org_b') $$,
  $$ select tests.id('user:bob@test.local'), 'owner' $$,
  'B still has exactly one member: its owner');

-- And the other direction: B sees nothing of A.
select tests.authenticate_as('bob@test.local');
select is_empty($$ select 1 from public.clients where organization_id = tests.id('org_a') $$, 'B cannot read A''s clients');
select is_empty($$ select 1 from public.organization_members where organization_id = tests.id('org_a') $$, 'B cannot read A''s members');
select is((select count(*)::int from public.organizations), 1, 'B sees exactly one organization: their own');
select is_empty($$ update public.clients set name = 'hacked' where organization_id = tests.id('org_a') returning 1 $$, 'B cannot update A''s clients');

select tests.clear_auth();
select * from finish();
rollback;
