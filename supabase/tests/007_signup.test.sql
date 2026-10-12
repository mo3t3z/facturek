-- Checkpoint D1: the signup trigger and the ensure_my_account() repair RPC.
-- tests.signup() does exactly what Supabase Auth does: one INSERT into auth.users.
begin;
select * from no_plan();

-- =========================================================================================
-- 1. A SIGNUP CREATES A COMPLETE ACCOUNT
-- =========================================================================================
select tests.signup('amel@test.local', '{"full_name":"  Amel Ben Salah  "}');

select is(
  (select full_name from public.profiles where id = tests.id('user:amel@test.local')),
  'Amel Ben Salah', 'a profile is created with the trimmed full_name');
select results_eq(
  $$ select o.name, m.role::text
     from public.organization_members m
     join public.organizations o on o.id = m.organization_id
     where m.user_id = tests.id('user:amel@test.local') $$,
  $$ values ('Amel Ben Salah', 'owner') $$,
  'exactly one organization is created, named after the user, with the user as owner');
select results_eq(
  $$ select t.default_tva_rate, t.timbre_fiscal, t.retenue_rate, t.retenue_threshold,
            t.timbre_enabled, t.retenue_enabled
     from public.tax_settings t
     join public.organization_members m on m.organization_id = t.organization_id
     where m.user_id = tests.id('user:amel@test.local') $$,
  $$ values (null::numeric, null::numeric, null::numeric, null::numeric, false, false) $$,
  'tax_settings exists with every rate and amount NULL and both switches off');
select is(
  (select count(*)::int from public.tax_settings t
   join public.organization_members m on m.organization_id = t.organization_id
   where m.user_id = tests.id('user:amel@test.local')),
  1, 'there is exactly one tax_settings row for the new organization');

-- Metadata variants.
select tests.signup('nometa@test.local');
select tests.signup('nullmeta@test.local', null);
select tests.signup('blank@test.local', '{"full_name":"   "}');
select tests.signup('long@test.local', jsonb_build_object('full_name', repeat('x', 250)));
select tests.signup('odd@test.local', '{"full_name":{"nested":true},"other":[1,2,3]}');

select results_eq(
  $$ select p.full_name, o.name
     from public.profiles p
     join public.organization_members m on m.user_id = p.id
     join public.organizations o on o.id = m.organization_id
     where p.id = tests.id('user:nometa@test.local') $$,
  $$ values (null::text, 'Mon activité') $$,
  'a signup without metadata works: no name, placeholder organization name');
select results_eq(
  $$ select p.full_name, o.name
     from public.profiles p
     join public.organization_members m on m.user_id = p.id
     join public.organizations o on o.id = m.organization_id
     where p.id = tests.id('user:nullmeta@test.local') $$,
  $$ values (null::text, 'Mon activité') $$,
  'a signup with NULL metadata works');
select results_eq(
  $$ select p.full_name, o.name
     from public.profiles p
     join public.organization_members m on m.user_id = p.id
     join public.organizations o on o.id = m.organization_id
     where p.id = tests.id('user:blank@test.local') $$,
  $$ values (null::text, 'Mon activité') $$,
  'a blank full_name is treated as no name');
select results_eq(
  $$ select length(p.full_name), length(o.name), p.full_name = repeat('x', 100)
     from public.profiles p
     join public.organization_members m on m.user_id = p.id
     join public.organizations o on o.id = m.organization_id
     where p.id = tests.id('user:long@test.local') $$,
  $$ values (100, 100, true) $$,
  'a full_name longer than 100 characters is truncated to 100, for the profile and the organization');
select is(
  (select count(*)::int from public.organization_members where user_id = tests.id('user:odd@test.local')),
  1, 'a signup with oddly shaped metadata still gets its organization');

select results_eq(
  $$ select count(*)::int, count(distinct m.organization_id)::int, count(distinct m.user_id)::int,
            count(*) filter (where m.role = 'owner')::int
     from public.organization_members m
     join auth.users u on u.id = m.user_id
     where u.email like '%@test.local' $$,
  $$ values (6, 6, 6, 6) $$,
  'six signups: six memberships, six different organizations, all owners');

-- =========================================================================================
-- 2. TWO SIGNUPS ARE TWO TENANTS
-- =========================================================================================
select tests.signup('sami@test.local', '{"full_name":"Sami"}');
select tests.remember('org_amel', (select organization_id from public.organization_members where user_id = tests.id('user:amel@test.local')));
select tests.remember('org_sami', (select organization_id from public.organization_members where user_id = tests.id('user:sami@test.local')));
select isnt(tests.id('org_amel'), tests.id('org_sami'), 'two signups get two different organizations');

-- A freshly signed-up owner can use their organization through the API.
select tests.authenticate_as('amel@test.local');
select is((select count(*)::int from public.organizations), 1, 'a new user sees exactly one organization: their own');
select lives_ok(
  $$ insert into public.clients (organization_id, name) values (tests.id('org_amel'), 'Client of Amel') $$,
  'a new owner can create a client');
select isnt_empty(
  $$ update public.tax_settings set timbre_enabled = true where organization_id = tests.id('org_amel') returning 1 $$,
  'a new owner can edit their tax settings');
select isnt_empty(
  $$ update public.organizations set name = 'Atelier Amel' where id = tests.id('org_amel') returning 1 $$,
  'a new owner can rename their organization');
select lives_ok(
  $$ insert into public.documents (organization_id, type) values (tests.id('org_amel'), 'facture') $$,
  'a new owner can create a draft document');

select tests.authenticate_as('sami@test.local');
select lives_ok(
  $$ insert into public.clients (organization_id, name) values (tests.id('org_sami'), 'Client of Sami') $$,
  'the second user can create a client in their own organization');
select is_empty($$ select 1 from public.organizations where id = tests.id('org_amel') $$, 'the second user cannot see the first user''s organization');
select is_empty($$ select 1 from public.clients where organization_id = tests.id('org_amel') $$, 'the second user cannot see the first user''s clients');
select is_empty($$ select 1 from public.documents where organization_id = tests.id('org_amel') $$, 'the second user cannot see the first user''s documents');
select is_empty($$ select 1 from public.tax_settings where organization_id = tests.id('org_amel') $$, 'the second user cannot see the first user''s tax settings');
select is_empty($$ select 1 from public.profiles where id = tests.id('user:amel@test.local') $$, 'the second user cannot see the first user''s profile');
select is_empty($$ select 1 from public.organization_members where organization_id = tests.id('org_amel') $$, 'the second user cannot see the first user''s membership');
select throws_ok(
  $$ insert into public.clients (organization_id, name) values (tests.id('org_amel'), 'intruder') $$,
  '42501', null, 'the second user cannot write into the first user''s organization');
select is_empty(
  $$ update public.organizations set name = 'hacked' where id = tests.id('org_amel') returning 1 $$,
  'the second user cannot rename the first user''s organization');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values (tests.id('org_amel'), tests.id('user:sami@test.local'), 'owner') $$,
  '42501', null, 'the second user still cannot add themselves to the first user''s organization');

select tests.authenticate_as('amel@test.local');
select is((select count(*)::int from public.clients), 1, 'the first user sees only their own client');
select tests.clear_auth();
select is((select name from public.organizations where id = tests.id('org_amel')), 'Atelier Amel', 'the first organization was not touched by the second user');


-- =========================================================================================
-- 3. ensure_my_account() FOR A USER WHO ALREADY HAS AN ACCOUNT, AND WHO MAY CALL IT
-- =========================================================================================
-- No-op for a user who already has an organization.
select tests.authenticate_as('amel@test.local');
select is(public.ensure_my_account(), tests.id('org_amel'), 'for a user with an organization it returns that organization');
select tests.clear_auth();
select results_eq(
  $$ select (select count(*)::int from public.organization_members where user_id = tests.id('user:amel@test.local')),
            (select name from public.organizations where id = tests.id('org_amel')),
            (select full_name from public.profiles where id = tests.id('user:amel@test.local')) $$,
  $$ values (1, 'Atelier Amel', 'Amel Ben Salah') $$,
  'and changes nothing: no second organization, name and profile untouched');

-- A user who belongs to several organizations: the first membership wins, nothing is created.
insert into public.organization_members (organization_id, user_id, role, created_at)
values (tests.id('org_sami'), tests.id('user:amel@test.local'), 'member', now() + interval '1 day');
select tests.authenticate_as('amel@test.local');
select is(public.ensure_my_account(), tests.id('org_amel'), 'with several memberships it returns the first one');
select tests.clear_auth();
select is(
  (select count(*)::int from public.organization_members where user_id = tests.id('user:amel@test.local')),
  2, 'and still creates nothing');

-- Who may call it.
select tests.authenticate_as_anon();
select throws_ok('select public.ensure_my_account()', '42501', null, 'anon cannot call ensure_my_account');
select tests.clear_auth();
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('role', 'authenticated', true);
select throws_ok('select public.ensure_my_account()', 'DF000', 'not authenticated', 'a call without a user id is rejected');
select tests.clear_auth();
select tests.authenticate_as('sami@test.local');
select throws_ok(
  $$ select private.provision_account(tests.id('user:amel@test.local'), 'x') $$,
  '42501', null, 'the API role cannot call the provisioning routine directly (so it cannot name another user)');
select tests.clear_auth();

select is(
  (select count(*)::int from public.organizations),
  7, 'after all of the above there are still exactly seven organizations: one per signup');

-- =========================================================================================
-- 4. THE TRIGGER NEVER MAKES A SIGNUP FAIL, AND THE USER CAN REPAIR THEIR ACCOUNT
-- =========================================================================================
-- (Last on purpose: if the trigger ever raised, the user below would not exist and the
-- rest of this section could not run.)
-- Force provisioning to fail: no organization can be inserted while this constraint exists.
alter table public.organizations add constraint test_block_new_organizations check (false) not valid;

select lives_ok(
  $$ select tests.signup('broken@test.local', '{"full_name":"Broken"}') $$,
  'the signup succeeds even though provisioning fails');
select isnt_empty($$ select 1 from auth.users where email = 'broken@test.local' $$, 'the auth user exists');
select is_empty(
  $$ select 1 from public.organization_members where user_id = tests.id('user:broken@test.local') $$,
  'the user has NO organization');
select is_empty(
  $$ select 1 from public.profiles where id = tests.id('user:broken@test.local') $$,
  'and no half-created account: the profile was rolled back with the rest');

-- ensure_my_account() does NOT swallow errors: while the cause is still there it raises.
select tests.authenticate_as('broken@test.local');
select throws_ok(
  'select public.ensure_my_account()', '23514', null,
  'ensure_my_account raises on a real failure instead of hiding it');
select tests.clear_auth();
select is_empty(
  $$ select 1 from public.profiles where id = tests.id('user:broken@test.local') $$,
  'a failed ensure_my_account leaves nothing behind either');

-- A second user in the same situation, used below to show nobody can repair someone else.
select tests.signup('ghost@test.local', '{"full_name":"Ghost"}');

alter table public.organizations drop constraint test_block_new_organizations;

-- Once the cause is gone, the user repairs their own account.
select tests.authenticate_as('broken@test.local');
select lives_ok('select public.ensure_my_account()', 'ensure_my_account creates the missing account');
select tests.clear_auth();
select results_eq(
  $$ select p.full_name, o.name, m.role::text,
            (select count(*)::int from public.tax_settings t where t.organization_id = o.id)
     from public.profiles p
     join public.organization_members m on m.user_id = p.id
     join public.organizations o on o.id = m.organization_id
     where p.id = tests.id('user:broken@test.local') $$,
  $$ values ('Broken', 'Broken', 'owner', 1) $$,
  'the repaired account has its profile, organization, owner membership and tax_settings');
select results_eq(
  $$ select t.default_tva_rate, t.timbre_fiscal, t.retenue_rate, t.retenue_threshold, t.timbre_enabled, t.retenue_enabled
     from public.tax_settings t
     join public.organization_members m on m.organization_id = t.organization_id
     where m.user_id = tests.id('user:broken@test.local') $$,
  $$ values (null::numeric, null::numeric, null::numeric, null::numeric, false, false) $$,
  'the repaired account''s tax_settings are empty too');
select tests.remember('org_broken', (select organization_id from public.organization_members where user_id = tests.id('user:broken@test.local')));

select tests.authenticate_as('broken@test.local');
select is(public.ensure_my_account(), tests.id('org_broken'), 'calling it again returns the same organization');
select is(public.ensure_my_account(), tests.id('org_broken'), 'and again');
select tests.clear_auth();
select results_eq(
  $$ select (select count(*)::int from public.organization_members where user_id = tests.id('user:broken@test.local')),
            (select count(*)::int from public.profiles where id = tests.id('user:broken@test.local')),
            (select count(*)::int from public.tax_settings where organization_id = tests.id('org_broken')),
            (select count(*)::int from public.organizations where name = 'Broken') $$,
  $$ values (1, 1, 1, 1) $$,
  'repeated calls created nothing new: still one membership, one profile, one tax_settings, one organization');

-- It only ever acts on the caller: "ghost" still has no account after others called it.
select tests.authenticate_as('sami@test.local');
select is(public.ensure_my_account(), tests.id('org_sami'), 'another user calling it gets their own organization');
select tests.clear_auth();
select is_empty(
  $$ select 1 from public.organization_members where user_id = tests.id('user:ghost@test.local') $$,
  'and the user without an account still has none: nobody can provision someone else');

-- The provisioning routine itself is idempotent (called here as superuser).
select tests.remember('org_ghost', private.provision_account(tests.id('user:ghost@test.local'), 'Ghost'));
select is(
  private.provision_account(tests.id('user:ghost@test.local'), 'Another name'),
  tests.id('org_ghost'), 'provision_account called twice returns the same organization');
select results_eq(
  $$ select count(*)::int, min(o.name)
     from public.organization_members m join public.organizations o on o.id = m.organization_id
     where m.user_id = tests.id('user:ghost@test.local') $$,
  $$ values (1, 'Ghost') $$,
  'and created exactly one organization, keeping the first name');

select * from finish();
rollback;
