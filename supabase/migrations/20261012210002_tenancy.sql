create type public.org_role as enum ('owner', 'admin', 'member');

-- organizations: the tenant. Its identity fields are the "seller" on documents.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  matricule_fiscal text,
  address text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);

-- Deny by default: RLS on, and no table privileges until explicitly granted.
-- Policies are added in the rls_policies migration.
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.organization_members from anon, authenticated;

grant select on table public.organizations to authenticated;
grant update (name, matricule_fiscal, address, email, phone) on table public.organizations to authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
grant select, insert, delete on table public.organization_members to authenticated;
grant update (role) on table public.organization_members to authenticated;

create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Rules that RLS cannot express because they depend on OTHER rows:
-- the last owner of an organization cannot be removed or demoted.
-- SECURITY DEFINER so it can lock the organization row regardless of the caller's rights.
create function private.guard_organization_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_losing_owner boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
      raise exception 'membership keys cannot be changed' using errcode = 'DF020';
    end if;
    v_losing_owner := old.role = 'owner' and new.role <> 'owner';
  else
    v_losing_owner := old.role = 'owner';
  end if;

  if v_losing_owner then
    -- Lock the organization so two owners cannot demote each other at the same time.
    perform 1 from public.organizations o where o.id = old.organization_id for update;
    if found and not exists (
      select 1
      from public.organization_members m
      where m.organization_id = old.organization_id
        and m.role = 'owner'
        and m.user_id <> old.user_id
    ) then
      raise exception 'the last owner cannot be removed or demoted' using errcode = 'DF020';
    end if;
    -- "not found" means the organization itself is being deleted (cascade): allow.
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_organization_members() from public;

create trigger guard_organization_members before update or delete on public.organization_members
  for each row execute function private.guard_organization_members();
