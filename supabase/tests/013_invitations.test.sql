-- R2: invitations, database layer (docs/roles-design.md, R-4 to R-6). Seed: in org_a alice is
-- the owner, carol an admin, dave a member; bob owns org_b. Invitees sign up for real
-- (tests.signup goes through the signup trigger, like Supabase Auth).
begin;
select * from no_plan();

select tests.seed();
select tests.signup('eve@test.local');
select tests.signup('frank@test.local');
select tests.signup('grace@test.local');
select tests.signup('heidi@test.local');
select tests.signup('ivan@test.local');
select tests.signup('judy@test.local');
-- grace has not confirmed her address yet.
update auth.users set email_confirmed_at = null where email = 'grace@test.local';

-- Tokens are returned once by create_invitation; the tests keep them here.
create temp table tok (k text primary key, token text not null, invitation_id uuid not null);
grant all on tok to authenticated;

-- 1. STRUCTURE AND PRIVILEGES ---------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.organization_invitations'::regclass), 'RLS is on');
select is_empty(
  $$ select privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'organization_invitations' and grantee in ('anon', 'authenticated') $$,
  'no table-level privilege for anon or authenticated');
select set_eq(
  $$ select column_name::text from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'organization_invitations' and grantee = 'authenticated' and privilege_type = 'SELECT' $$,
  $$ values ('id'), ('organization_id'), ('email'), ('role'), ('invited_by'), ('created_at'), ('expires_at'), ('accepted_at'), ('accepted_by'), ('revoked_at') $$,
  'authenticated may read every column but token_hash');
select is_empty(
  $$ select privilege_type from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'organization_invitations' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT' $$,
  'no column may be written by the API role');
select set_eq(
  $$ select cmd::text from pg_policies where schemaname = 'public' and tablename = 'organization_invitations' $$,
  $$ values ('SELECT') $$, 'the only policy is SELECT');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('create_invitation', 'revoke_invitation', 'accept_invitation')
     and p.prosecdef and p.proconfig = array['search_path=""']
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')),
  3, 'the three functions: SECURITY DEFINER, empty search_path, EXECUTE for authenticated only');
select ok(not has_function_privilege('authenticated', 'private.guard_organization_invitations()', 'EXECUTE'), 'the guard trigger function cannot be called');

-- 2. CREATE: who may invite whom -------------------------------------------------------------
select tests.authenticate_as('alice@test.local');
insert into tok select 'eve', token, invitation_id from public.create_invitation(tests.id('org_a'), '  Eve@Test.Local ', 'member');
insert into tok select 'frank_admin', token, invitation_id from public.create_invitation(tests.id('org_a'), 'frank@test.local', 'admin');
select throws_ok($$ select * from public.create_invitation(tests.id('org_a'), 'x@test.local', 'owner') $$, 'DF026', null, 'owner: nobody is invited as owner');
select throws_ok($$ select * from public.create_invitation(tests.id('org_a'), 'not an address', 'member') $$, '22023', null, 'owner: an invalid address is refused');
select throws_ok($$ select * from public.create_invitation(tests.id('org_b'), 'x@test.local', 'member') $$, '42501', null, 'owner of org_a: cannot invite into org_b');
select tests.clear_auth();

select tests.authenticate_as('carol@test.local');
select lives_ok($$ insert into tok select 'grace', token, invitation_id from public.create_invitation(tests.id('org_a'), 'grace@test.local', 'member') $$, 'admin: may invite a member');
select throws_ok($$ select * from public.create_invitation(tests.id('org_a'), 'y@test.local', 'admin') $$, 'DF026', null, 'admin: may not invite an admin');
select tests.clear_auth();

select tests.authenticate_as('dave@test.local');
select throws_ok($$ select * from public.create_invitation(tests.id('org_a'), 'z@test.local', 'member') $$, 'DF026', null, 'member: may invite nobody');
select tests.clear_auth();

select throws_ok($$ select * from public.create_invitation(tests.id('org_a'), 'z@test.local', 'member') $$, 'DF000', null, 'no user id: DF000');

-- What was stored, and what was not.
select results_eq(
  $$ select i.email, i.role::text, i.invited_by from public.organization_invitations i join tok on tok.invitation_id = i.id where tok.k = 'eve' $$,
  $$ select 'eve@test.local', 'member', tests.id('user:alice@test.local') $$,
  'the address is stored trimmed and in lower case, with the role and the inviter');
select ok((select token ~ '^[A-Za-z0-9_-]{43}$' from tok where k = 'eve'), 'the token is 43 base64url characters: 32 random bytes, 256 bits');
select is(
  (select i.token_hash from public.organization_invitations i join tok on tok.invitation_id = i.id where tok.k = 'eve'),
  (select sha256(convert_to(token, 'UTF8')) from tok where k = 'eve'),
  'only sha256 of the token is stored');
select is(
  (select count(*)::int from public.organization_invitations i, tok where position(tok.token in to_jsonb(i)::text) > 0),
  0, 'no raw token appears anywhere in the stored rows');
select is(
  (select expires_at - created_at from public.organization_invitations i join tok on tok.invitation_id = i.id where tok.k = 'eve'),
  interval '7 days', 'an invitation expires 7 days after its creation');
select isnt((select token from tok where k = 'eve'), (select token from tok where k = 'frank_admin'), 'two invitations get two different tokens');

-- A new invitation for the same address revokes the pending one.
select tests.authenticate_as('alice@test.local');
insert into tok select 'judy_old', token, invitation_id from public.create_invitation(tests.id('org_a'), 'judy@test.local', 'member');
insert into tok select 'judy_new', token, invitation_id from public.create_invitation(tests.id('org_a'), 'judy@test.local', 'member');
select tests.clear_auth();
select ok((select revoked_at is not null from public.organization_invitations i join tok on tok.invitation_id = i.id where tok.k = 'judy_old'), 'the previous invitation of the same address is revoked');
select is((select count(*)::int from public.organization_invitations where email = 'judy@test.local' and accepted_at is null and revoked_at is null), 1, 'one pending invitation per address and organization');

-- 3. NO DIRECT PATH ----------------------------------------------------------------------------
select tests.authenticate_as('alice@test.local');
select throws_ok(
  $$ insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
     values (tests.id('org_a'), 'x@test.local', 'member', sha256('x'::bytea), tests.id('user:alice@test.local')) $$,
  '42501', null, 'owner: cannot insert an invitation directly');
select throws_ok($$ update public.organization_invitations set role = 'admin' $$, '42501', null, 'owner: cannot update an invitation directly');
select throws_ok($$ update public.organization_invitations set accepted_at = now() $$, '42501', null, 'owner: cannot mark an invitation accepted directly');
select throws_ok($$ delete from public.organization_invitations $$, '42501', null, 'owner: cannot delete an invitation directly');
select throws_ok($$ select token_hash from public.organization_invitations $$, '42501', null, 'owner: cannot read the token hash');
select is((select count(*)::int from public.organization_invitations where organization_id = tests.id('org_a')), 5, 'owner: reads the invitations of the organization');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role) values (tests.id('org_a'), tests.id('user:eve@test.local'), 'member') $$,
  '42501', null, 'a membership still cannot be inserted directly');
select tests.clear_auth();

select tests.authenticate_as('carol@test.local');
select is((select count(*)::int from public.organization_invitations), 5, 'admin: reads the invitations of the organization');
select tests.clear_auth();
select tests.authenticate_as('dave@test.local');
select is_empty($$ select 1 from public.organization_invitations $$, 'member: reads no invitation');
select tests.clear_auth();
select tests.authenticate_as('bob@test.local');
select is_empty($$ select 1 from public.organization_invitations $$, 'owner of another organization: reads none of them');
select throws_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'judy_new')) $$, 'DF027', null, 'owner of another organization: cannot revoke (DF027, as if unknown)');
select tests.clear_auth();
select tests.authenticate_as('eve@test.local');
select is_empty($$ select 1 from public.organization_invitations $$, 'the invitee reads no invitation either (nothing to enumerate)');
select tests.clear_auth();
select throws_ok($$ select public.accept_invitation('x') $$, 'DF000', null, 'accept without a user id: DF000');

-- Every role is bound by the trigger (DF029).
select throws_ok(
  $$ update public.organization_invitations set email = 'other@test.local' where id = (select invitation_id from tok where k = 'eve') $$,
  'DF029', null, 'superuser: the address of an invitation cannot change');
select throws_ok(
  $$ update public.organization_invitations set expires_at = expires_at + interval '1 day' where id = (select invitation_id from tok where k = 'eve') $$,
  'DF029', null, 'superuser: an invitation cannot be extended');

-- 4. ACCEPT ------------------------------------------------------------------------------------------
-- Another signed-in user with the token: DF027.
select tests.authenticate_as('frank@test.local');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'eve')) $$, 'DF027', null, 'another address: DF027');
select tests.clear_auth();

-- Nothing at login: ensure_my_account does not accept anything.
select tests.authenticate_as('eve@test.local');
select public.ensure_my_account();
select tests.clear_auth();
select is((select count(*)::int from public.organization_members where user_id = tests.id('user:eve@test.local') and organization_id = tests.id('org_a')), 0,
  'nothing is accepted at login: no membership before accept_invitation()');

select tests.authenticate_as('eve@test.local');
select is(public.accept_invitation((select token from tok where k = 'eve')), tests.id('org_a'), 'the invitee accepts and gets the organization id');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'eve')) $$, 'DF027', null, 'a used token: DF027');
select tests.clear_auth();
select results_eq(
  $$ select m.role::text from public.organization_members m where m.organization_id = tests.id('org_a') and m.user_id = tests.id('user:eve@test.local') $$,
  $$ values ('member') $$, 'one membership, with the role of the invitation');
select results_eq(
  $$ select accepted_by, accepted_at is not null, revoked_at is null from public.organization_invitations where id = (select invitation_id from tok where k = 'eve') $$,
  $$ select tests.id('user:eve@test.local'), true, true $$, 'the invitation is marked accepted by eve');
select throws_ok(
  $$ update public.organization_invitations set revoked_at = now() where id = (select invitation_id from tok where k = 'eve') $$,
  'DF029', null, 'superuser: an accepted invitation is frozen');

-- An unconfirmed address: DF027; the same invitation works once the address is confirmed.
select tests.authenticate_as('grace@test.local');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'grace')) $$, 'DF027', null, 'an unconfirmed address: DF027');
select tests.clear_auth();
update auth.users set email_confirmed_at = now() where email = 'grace@test.local';
select tests.authenticate_as('grace@test.local');
select lives_ok($$ select public.accept_invitation((select token from tok where k = 'grace')) $$, 'the same invitation, once the address is confirmed: accepted');
select tests.clear_auth();

-- The invited admin.
select tests.authenticate_as('frank@test.local');
select lives_ok($$ select public.accept_invitation((select token from tok where k = 'frank_admin')) $$, 'frank accepts the admin invitation');
select tests.clear_auth();
select is((select role::text from public.organization_members where organization_id = tests.id('org_a') and user_id = tests.id('user:frank@test.local')), 'admin', 'frank is admin of org_a');

-- Garbage, NULL, a revoked one, an expired one: the same DF027.
select tests.authenticate_as('judy@test.local');
select throws_ok($$ select public.accept_invitation('not-a-token') $$, 'DF027', null, 'garbage: DF027');
select throws_ok($$ select public.accept_invitation(null) $$, 'DF027', null, 'NULL: DF027');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'judy_old')) $$, 'DF027', null, 'a revoked (replaced) invitation: DF027');
select tests.clear_auth();

-- Expired: a row created 8 days ago with a known token (as superuser, like a clock jump).
insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by, created_at, expires_at)
values (tests.id('org_a'), 'heidi@test.local', 'member', sha256(convert_to('expired-token-expired-token-expired-token-xx', 'UTF8')),
        tests.id('user:alice@test.local'), now() - interval '8 days', now() - interval '1 day');
select tests.authenticate_as('heidi@test.local');
select throws_ok($$ select public.accept_invitation('expired-token-expired-token-expired-token-xx') $$, 'DF027', null, 'an expired invitation: DF027');
select tests.clear_auth();

-- 5. REVOKE -------------------------------------------------------------------------------------
select tests.authenticate_as('alice@test.local');
insert into tok select 'ivan_admin', token, invitation_id from public.create_invitation(tests.id('org_a'), 'ivan@test.local', 'admin');
select tests.clear_auth();
select tests.authenticate_as('dave@test.local');
select throws_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'judy_new')) $$, 'DF027', null, 'member: cannot revoke (DF027)');
select tests.clear_auth();
select tests.authenticate_as('carol@test.local');
select throws_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'ivan_admin')) $$, 'DF026', null, 'admin: cannot revoke an admin invitation (DF026)');
select lives_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'judy_new')) $$, 'admin: revokes a member invitation');
select throws_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'judy_new')) $$, 'DF027', null, 'revoking twice: DF027');
select throws_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'eve')) $$, 'DF027', null, 'revoking an accepted invitation: DF027');
select tests.clear_auth();
select tests.authenticate_as('alice@test.local');
select lives_ok($$ select public.revoke_invitation((select invitation_id from tok where k = 'ivan_admin')) $$, 'owner: revokes an admin invitation');
select tests.clear_auth();
select tests.authenticate_as('judy@test.local');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'judy_new')) $$, 'DF027', null, 'a revoked invitation: DF027');
select tests.clear_auth();
select tests.authenticate_as('ivan@test.local');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'ivan_admin')) $$, 'DF027', null, 'a revoked admin invitation: DF027');
select tests.clear_auth();

-- 6. ALREADY A MEMBER: DF028 only for a valid invitation of the caller ---------------------------
select tests.authenticate_as('alice@test.local');
insert into tok select 'dave_again', token, invitation_id from public.create_invitation(tests.id('org_a'), 'dave@test.local', 'admin');
select tests.clear_auth();
select tests.authenticate_as('frank@test.local');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'dave_again')) $$, 'DF027', null, 'someone else with that token: DF027, never DF028');
select tests.clear_auth();
select tests.authenticate_as('dave@test.local');
select throws_ok($$ select public.accept_invitation((select token from tok where k = 'dave_again')) $$, 'DF028', null, 'dave, already a member, with his own valid invitation: DF028');
select tests.clear_auth();
select results_eq(
  $$ select (select role::text from public.organization_members where organization_id = tests.id('org_a') and user_id = tests.id('user:dave@test.local')),
            (select accepted_at is null from public.organization_invitations where id = (select invitation_id from tok where k = 'dave_again')) $$,
  $$ values ('member', true) $$, 'dave keeps his role (an invitation never changes a role) and the invitation stays pending');

-- 7. ISOLATION AND R1 STILL HOLDS ----------------------------------------------------------------
select is((select count(*)::int from public.organization_members where organization_id = tests.id('org_b')), 1, 'org_b still has its single member');
select tests.create_draft('r2_draft_member', tests.id('org_a'), tests.id('client_a'));
select tests.create_draft('r2_draft_admin', tests.id('org_a'), tests.id('client_a'));
select tests.authenticate_as('eve@test.local');
select isnt_empty($$ select 1 from public.documents where organization_id = tests.id('org_a') $$, 'the new member reads the organization''s documents');
select is_empty($$ select 1 from public.documents where organization_id = tests.id('org_b') $$, 'and nothing of another organization');
select throws_ok($$ select public.finalize_document(tests.id('r2_draft_member'), '100.000') $$, 'DF026', null, 'R1: an invited member cannot issue (DF026)');
select tests.clear_auth();
select tests.authenticate_as('frank@test.local');
select lives_ok($$ select public.finalize_document(tests.id('r2_draft_admin'), '100.000') $$, 'R1: an invited admin can issue');
select tests.clear_auth();

select * from finish();
rollback;
