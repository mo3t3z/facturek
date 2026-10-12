-- Same-org access by role: alice = owner, carol = admin, dave = member of org_a.
begin;
select * from no_plan();

select tests.seed();

-- MEMBER --------------------------------------------------------------------------------
select tests.authenticate_as('dave@test.local');

select isnt_empty($$ select 1 from public.clients where id = tests.id('client_a') $$, 'member reads shared clients');
select isnt_empty($$ select 1 from public.tax_settings where organization_id = tests.id('org_a') $$, 'member reads tax settings');
select isnt_empty($$ select 1 from public.organizations where id = tests.id('org_a') $$, 'member reads the organization');
select is(
  (select count(*)::int from public.organization_members where organization_id = tests.id('org_a')), 3,
  'member sees the 3 members of the shared org');
select isnt_empty($$ select 1 from public.profiles where id = tests.id('user:alice@test.local') $$, 'member reads a colleague''s profile');
select is_empty($$ select 1 from public.profiles where id = tests.id('user:bob@test.local') $$, 'member cannot read a stranger''s profile');
select is_empty($$ select 1 from public.clients where organization_id = tests.id('org_b') $$, 'member of A still cannot read B');

select lives_ok(
  $$ insert into public.clients (organization_id, name) values (tests.id('org_a'), 'Client by member') $$,
  'member can create a client');
select isnt_empty(
  $$ update public.clients set phone = '222' where id = tests.id('client_a') returning 1 $$,
  'member can update a client');
select isnt_empty(
  $$ delete from public.clients where organization_id = tests.id('org_a') and name = 'Client by member' returning 1 $$,
  'member can delete a client');

select is_empty(
  $$ update public.tax_settings set timbre_fiscal = 0 where organization_id = tests.id('org_a') returning 1 $$,
  'member cannot update tax settings');
select is_empty(
  $$ update public.organizations set name = 'renamed' where id = tests.id('org_a') returning 1 $$,
  'member cannot update the organization');
select is_empty(
  $$ update public.profiles set full_name = 'hacked' where id = tests.id('user:alice@test.local') returning 1 $$,
  'member cannot update a colleague''s profile');
select isnt_empty(
  $$ update public.profiles set full_name = 'Dave D.' where id = tests.id('user:dave@test.local') returning 1 $$,
  'member can update their own profile');

-- Privilege escalation attempts by a member.
select is_empty(
  $$ update public.organization_members set role = 'admin'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') returning 1 $$,
  'member cannot promote themselves to admin');
select is_empty(
  $$ update public.organization_members set role = 'owner'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') returning 1 $$,
  'member cannot promote themselves to owner');
select is_empty(
  $$ update public.organization_members set role = 'member'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:carol@test.local') returning 1 $$,
  'member cannot change someone else''s role');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values (tests.id('org_a'), tests.id('user:bob@test.local'), 'member') $$,
  '42501', null, 'member cannot add members');
select is_empty(
  $$ delete from public.organization_members
     where organization_id = tests.id('org_a') and user_id = tests.id('user:carol@test.local') returning 1 $$,
  'member cannot remove someone else');

-- ADMIN ---------------------------------------------------------------------------------
select tests.authenticate_as('carol@test.local');

select isnt_empty(
  $$ update public.tax_settings set retenue_enabled = true where organization_id = tests.id('org_a') returning 1 $$,
  'admin can update tax settings');
select is_empty(
  $$ update public.organizations set name = 'renamed' where id = tests.id('org_a') returning 1 $$,
  'admin cannot update the organization');
select isnt_empty(
  $$ update public.organization_members set role = 'admin'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') returning 1 $$,
  'admin can promote a member to admin');
select isnt_empty(
  $$ update public.organization_members set role = 'member'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') returning 1 $$,
  'admin can demote an admin to member');

-- Privilege escalation attempts by an admin.
select throws_ok(
  $$ update public.organization_members set role = 'owner'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') $$,
  '42501', null, 'admin cannot grant owner to someone else');
select throws_ok(
  $$ update public.organization_members set role = 'owner'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:carol@test.local') $$,
  '42501', null, 'admin cannot grant owner to themselves');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values (tests.id('org_a'), tests.id('user:bob@test.local'), 'owner') $$,
  '42501', null, 'admin cannot add a new member as owner');
select is_empty(
  $$ update public.organization_members set role = 'member'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:alice@test.local') returning 1 $$,
  'admin cannot demote an owner');
select is_empty(
  $$ delete from public.organization_members
     where organization_id = tests.id('org_a') and user_id = tests.id('user:alice@test.local') returning 1 $$,
  'admin cannot remove an owner');
select throws_ok(
  $$ update public.organization_members set user_id = tests.id('user:bob@test.local')
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') $$,
  '42501', null, 'membership keys are not updatable from the API');

-- OWNER ---------------------------------------------------------------------------------
select tests.authenticate_as('alice@test.local');

select isnt_empty(
  $$ update public.organizations set name = 'Org A renamed' where id = tests.id('org_a') returning 1 $$,
  'owner can update the organization');
select throws_ok(
  $$ update public.organization_members set role = 'admin'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:alice@test.local') $$,
  'DF020', null, 'the last owner cannot demote themselves');
select throws_ok(
  $$ delete from public.organization_members
     where organization_id = tests.id('org_a') and user_id = tests.id('user:alice@test.local') $$,
  'DF020', null, 'the last owner cannot leave');
select isnt_empty(
  $$ update public.organization_members set role = 'owner'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:carol@test.local') returning 1 $$,
  'owner can grant owner');
select isnt_empty(
  $$ update public.organization_members set role = 'admin'
     where organization_id = tests.id('org_a') and user_id = tests.id('user:alice@test.local') returning 1 $$,
  'an owner can step down once another owner exists');

-- carol is now the only owner; the rule protects her too.
select tests.authenticate_as('carol@test.local');
select throws_ok(
  $$ delete from public.organization_members
     where organization_id = tests.id('org_a') and user_id = tests.id('user:carol@test.local') $$,
  'DF020', null, 'the new last owner cannot leave either');

-- A plain member may leave.
select tests.authenticate_as('dave@test.local');
select isnt_empty(
  $$ delete from public.organization_members
     where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local') returning 1 $$,
  'a member can leave the organization');
select is_empty($$ select 1 from public.clients where organization_id = tests.id('org_a') $$, 'after leaving, access is gone');

-- The rules hold below RLS too (e.g. service role / SQL editor).
select tests.clear_auth();
select throws_ok(
  $$ delete from public.organization_members where organization_id = tests.id('org_b') $$,
  'DF020', null, 'even without RLS the last owner cannot be removed');
select throws_ok(
  $$ update public.organization_members set role = 'member' where organization_id = tests.id('org_b') $$,
  'DF020', null, 'even without RLS the last owner cannot be demoted');
select throws_ok(
  $$ update public.organization_members set organization_id = tests.id('org_b')
     where organization_id = tests.id('org_a') and user_id = tests.id('user:carol@test.local') $$,
  'DF020', null, 'even without RLS a membership cannot be moved to another organization');
select throws_ok(
  $$ update public.clients set organization_id = tests.id('org_b') where id = tests.id('client_a') $$,
  'DF040', null, 'even without RLS a client cannot be moved to another organization');
select is(
  (select count(*)::int from public.organization_members where organization_id = tests.id('org_a') and role = 'owner'), 1,
  'org_a still has exactly one owner');

select * from finish();
rollback;
