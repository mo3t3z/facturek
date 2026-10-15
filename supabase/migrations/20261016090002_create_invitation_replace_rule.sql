-- R2 fix. create_invitation could revoke an invitation its caller may not revoke.
--
-- Found by a local adversarial probe (scripts/security-invitation-probe.mjs, not part of the
-- repository): an admin cannot revoke a pending ADMIN invitation (revoke_invitation answers
-- DF026), but creating a MEMBER invitation for the same address revoked it anyway, because
-- create_invitation replaces the pending invitation of that address without looking at its
-- role. The owner's invitation was cancelled by someone not allowed to cancel it.
--
-- Fix: the same function, with one check added under the organization lock and before the
-- replacement: if a pending admin invitation exists for that address, only the owner may
-- replace it (DF026 otherwise, nothing is revoked). Everything else is unchanged.
-- A new migration rather than an edit of 20261016090001: the database that already applied
-- it is brought to the same state by the migration chain, never by hand.

create or replace function public.create_invitation(p_organization_id uuid, p_email text, p_role public.org_role)
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

  -- Replacing an invitation revokes it, so it needs the right to revoke it: an admin may not
  -- replace (revoke) a pending ADMIN invitation of this address, exactly as revoke_invitation
  -- refuses it. Checked under the lock above, before anything is revoked.
  if exists (
    select 1
    from public.organization_invitations i
    where i.organization_id = p_organization_id
      and i.email = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.role = 'admin'
  ) and not private.has_org_role(p_organization_id, array['owner']::public.org_role[]) then
    raise exception 'your role does not allow replacing this invitation' using errcode = 'DF026';
  end if;

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

revoke all on function public.create_invitation(uuid, text, public.org_role) from public, anon, authenticated, service_role;
grant execute on function public.create_invitation(uuid, text, public.org_role) to authenticated;
