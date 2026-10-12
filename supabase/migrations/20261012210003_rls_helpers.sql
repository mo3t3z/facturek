-- Membership checks used by every RLS policy.
-- SECURITY DEFINER: they read organization_members without going through its own RLS
-- policies, which would otherwise recurse forever (the policy on that table calls them).
-- They only ever answer about the CURRENT user (auth.uid()), so they leak nothing.

create function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

create function private.has_org_role(p_organization_id uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- True when the current user and p_user_id belong to at least one common organization.
create function private.shares_org_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public;
revoke all on function private.shares_org_with(uuid) from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated;
grant execute on function private.shares_org_with(uuid) to authenticated;
