-- R2. Invitations, database layer only (docs/roles-design.md, R-4 to R-6 and the security
-- requirements approved 2026-10-15). No screen, no e-mail sender, no transfer of ownership.
--
--   create_invitation(p_organization_id, p_email, p_role)  -> (invitation_id, token, expires_at)
--   revoke_invitation(p_invitation_id)
--   accept_invitation(p_token)                              -> organization_id
--
-- The token:
--   * 32 bytes from extensions.gen_random_bytes() (pgcrypto, a cryptographically secure
--     generator): 256 bits of entropy, encoded base64url without padding (43 characters).
--   * Returned ONCE, by create_invitation(). Only sha256() of its text is stored; nothing
--     writes the raw token anywhere (no table, no RAISE, no NOTICE).
--   * Valid 7 days, usable once. An invitation row is locked FOR UPDATE while it is
--     accepted, so two simultaneous acceptances cannot both use it.
-- The recipient:
--   * One e-mail address per invitation, stored normalized (trimmed, lower case).
--   * accept_invitation() reads the caller's e-mail and its confirmation from auth.users
--     (the server's source of truth), never from the request. Nothing is accepted at login:
--     only an explicit call to accept_invitation() creates the membership.
-- Errors:
--   * DF027 is the ONE answer for every invalid case (no such token, expired, revoked, used,
--     another address, an unconfirmed address): nothing tells them apart.
--   * DF028 "already a member" only AFTER the invitation is valid and is for the caller.
-- The data model already holds everything an e-mail sender will need later (address,
-- organization, role, expiry, state): sending e-mails will be a new sender, not a new model.

-- 1. The table ------------------------------------------------------------------------------
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null
    constraint organization_invitations_email_normalized check (email = lower(btrim(email)))
    constraint organization_invitations_email_shape check (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$'),
  -- Never owner: ownership is transferred (R-10), never given by an invitation (R-6).
  role public.org_role not null
    constraint organization_invitations_role_not_owner check (role in ('admin', 'member')),
  token_hash bytea not null unique
    constraint organization_invitations_token_hash_size check (length(token_hash) = 32),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint organization_invitations_expires_after_creation check (expires_at > created_at),
  constraint organization_invitations_one_outcome check (accepted_at is null or revoked_at is null),
  constraint organization_invitations_accepted_by check ((accepted_at is null) = (accepted_by is null))
);

comment on table public.organization_invitations is
  'Invitations to join an organization. Written only by create_invitation, revoke_invitation and accept_invitation. token_hash is sha256 of the token; the token itself is never stored.';

-- One pending invitation per address and organization (a new one revokes the previous).
create unique index organization_invitations_one_pending
  on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

-- 2. Privileges and RLS --------------------------------------------------------------------
-- The API role may READ the invitations of an organization it owns or administers, without
-- the token hash. It may write nothing: the three functions are its only path.
alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;
grant select (id, organization_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.organization_invitations to authenticated;

create policy organization_invitations_select on public.organization_invitations
  for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- 3. A row changes only in the two ways the functions change it, for every role --------------
-- Pending -> accepted (accepted_at and accepted_by set) or pending -> revoked (revoked_at
-- set). Nothing else ever changes: not the address, the role, the organization, the token
-- hash, the dates, and not a row that is already accepted or revoked (DF029).
create function private.guard_organization_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'accepted_at' - 'accepted_by' - 'revoked_at')
       is distinct from (to_jsonb(old) - 'accepted_at' - 'accepted_by' - 'revoked_at')
     or old.accepted_at is not null
     or old.revoked_at is not null
  then
    raise exception 'an invitation cannot be changed, except once to accepted or revoked'
      using errcode = 'DF029';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_organization_invitations() from public, anon, authenticated, service_role;

create trigger guard_organization_invitations
  before update on public.organization_invitations
  for each row execute function private.guard_organization_invitations();

-- 4. create_invitation ------------------------------------------------------------------------
create function public.create_invitation(p_organization_id uuid, p_email text, p_role public.org_role)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text;
  v_row public.organization_invitations;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  -- Not a member of that organization: the same refusal as any other forbidden write.
  if not private.is_org_member(p_organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- R-6: owner invites admin or member; admin invites member; member nobody; owner never.
  if p_role is null
     or p_role = 'owner'
     or not private.has_org_role(p_organization_id, array['owner', 'admin']::public.org_role[])
     or (p_role = 'admin' and not private.has_org_role(p_organization_id, array['owner']::public.org_role[]))
  then
    raise exception 'your role does not allow this invitation' using errcode = 'DF026';
  end if;

  if v_email is null or length(v_email) not between 3 and 254 or v_email !~ '^[^@\s]+@[^@\s]+$' then
    raise exception 'invalid e-mail address' using errcode = '22023';
  end if;

  -- Two invitations for the same address created at once: the organization row serializes
  -- them, and the second one revokes the first.
  perform 1 from public.organizations o where o.id = p_organization_id for update;

  update public.organization_invitations i
  set revoked_at = now()
  where i.organization_id = p_organization_id
    and i.email = v_email
    and i.accepted_at is null
    and i.revoked_at is null;

  -- 256 bits from a cryptographically secure generator, base64url without padding.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.organization_invitations (organization_id, email, role, token_hash, invited_by)
  values (p_organization_id, v_email, p_role, sha256(convert_to(v_token, 'UTF8')), auth.uid())
  returning * into v_row;

  return query select v_row.id, v_token, v_row.expires_at;
end;
$$;

-- 5. revoke_invitation ------------------------------------------------------------------------
-- Owner: any pending invitation of the organization. Admin: pending invitations as member
-- only. Anyone else, an unknown id, or an invitation that is no longer pending: DF027.
create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.organization_invitations;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  select i.* into v_row
  from public.organization_invitations i
  where i.id = p_invitation_id
    and private.has_org_role(i.organization_id, array['owner', 'admin']::public.org_role[])
  for update;

  if not found or v_row.accepted_at is not null or v_row.revoked_at is not null then
    raise exception 'invitation not valid' using errcode = 'DF027';
  end if;

  if v_row.role = 'admin' and not private.has_org_role(v_row.organization_id, array['owner']::public.org_role[]) then
    raise exception 'your role does not allow this action' using errcode = 'DF026';
  end if;

  update public.organization_invitations i
  set revoked_at = now()
  where i.id = v_row.id;
end;
$$;

-- 6. accept_invitation ------------------------------------------------------------------------
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_row public.organization_invitations;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  -- The caller's address and its confirmation, from Supabase Auth itself.
  select lower(btrim(u.email)), u.email_confirmed_at into v_email, v_confirmed_at
  from auth.users u
  where u.id = v_user_id;

  -- A token that cannot be one is looked up anyway (and found nowhere): same path, same answer.
  select i.* into v_row
  from public.organization_invitations i
  where i.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
  for update;

  -- ONE answer for every invalid case: nothing tells which condition failed.
  if not found
     or v_row.accepted_at is not null
     or v_row.revoked_at is not null
     or v_row.expires_at <= now()
     or v_confirmed_at is null
     or v_email is null
     or v_email <> v_row.email
  then
    raise exception 'invitation not valid' using errcode = 'DF027';
  end if;

  -- The invitation is valid and is for the caller: only now may the caller learn that it
  -- is already a member. The organization row serializes two acceptances for the same user.
  perform 1 from public.organizations o where o.id = v_row.organization_id for update;
  if exists (
    select 1 from public.organization_members m
    where m.organization_id = v_row.organization_id and m.user_id = v_user_id
  ) then
    raise exception 'already a member of this organization' using errcode = 'DF028';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_row.organization_id, v_user_id, v_row.role);

  update public.organization_invitations i
  set accepted_at = now(), accepted_by = v_user_id
  where i.id = v_row.id;

  return v_row.organization_id;
end;
$$;

-- 7. EXECUTE: authenticated only ------------------------------------------------------------
revoke all on function public.create_invitation(uuid, text, public.org_role) from public, anon, authenticated, service_role;
grant execute on function public.create_invitation(uuid, text, public.org_role) to authenticated;
revoke all on function public.revoke_invitation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_invitation(uuid) to authenticated;
revoke all on function public.accept_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_invitation(text) to authenticated;

notify pgrst, 'reload schema';
