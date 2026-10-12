-- Checkpoint D1: every user gets an account (profile, organization, owner membership,
-- empty tax settings) without the frontend ever inserting those rows itself.
--
-- Two entry points, and they are the ONLY code that creates a membership:
--   * private.handle_new_user()   trigger on auth.users, runs at signup
--   * public.ensure_my_account()  RPC, repairs an account whose signup provisioning failed
-- Both call private.provision_account(), so there is one place where the rows are created.

-- 1. The shared provisioning routine ------------------------------------------------------
-- Idempotent: it creates a default organization only for a user who has no membership at
-- all, so calling it again (or from both entry points) never creates a second one.
-- Not SECURITY DEFINER itself: it is only ever called from the two definer functions
-- below and runs with their rights. No API role can execute it.
create function private.provision_account(p_user_id uuid, p_full_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  -- Trimmed, at most 100 characters, NULL when nothing is left.
  v_full_name text := nullif(left(btrim(p_full_name, E' \t\n\r'), 100), '');
  v_organization_id uuid;
begin
  -- One provisioning at a time per user. Without this lock two simultaneous calls could
  -- both see "no membership yet" and each create an organization. The lock is released
  -- automatically when the transaction ends; the second caller then re-reads the
  -- memberships below and finds the one the first caller created.
  perform pg_advisory_xact_lock(hashtextextended('provision_account:' || p_user_id::text, 0));

  insert into public.profiles (id, full_name)
  values (p_user_id, v_full_name)
  on conflict (id) do nothing;

  -- The user's first membership: the oldest one (the id breaks ties so the answer is stable).
  select m.organization_id into v_organization_id
  from public.organization_members m
  where m.user_id = p_user_id
  order by m.created_at, m.organization_id
  limit 1;

  if v_organization_id is null then
    -- 'Mon activité' is only a placeholder name for a user who gave no name; the user
    -- renames the organization in the settings. It is not a tax value.
    insert into public.organizations (name)
    values (coalesce(v_full_name, 'Mon activité'))
    returning id into v_organization_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (v_organization_id, p_user_id, 'owner');

    -- Empty on purpose: every rate and amount stays NULL, timbre_enabled and
    -- retenue_enabled stay false. No tax value is ever assumed for a new organization.
    insert into public.tax_settings (organization_id)
    values (v_organization_id)
    on conflict (organization_id) do nothing;
  end if;

  return v_organization_id;
end;
$$;
revoke all on function private.provision_account(uuid, text) from public, anon, authenticated, service_role;

-- 2. Signup trigger -----------------------------------------------------------------------
-- Runs inside the transaction in which Supabase Auth inserts the user.
-- It must NEVER make a signup fail: any error raised here would abort that transaction
-- and the user would only see a generic 500 from the auth server. So every error is
-- caught, logged as a WARNING with its SQLSTATE, and the signup goes through.
-- Consequence, accepted on purpose: a user can exist WITHOUT a profile and organization.
-- The frontend calls ensure_my_account() after login to repair that.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.provision_account(new.id, new.raw_user_meta_data ->> 'full_name');
  exception when others then
    -- The inner block is a savepoint: whatever provision_account had already written is
    -- rolled back, so a failed provisioning never leaves half an account behind.
    raise warning 'account provisioning failed for user % (SQLSTATE %): %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- 3. Repair RPC ---------------------------------------------------------------------------
-- Frontend: supabase.rpc('ensure_my_account') right after login.
-- No parameter: it can only ever act on the caller (auth.uid()), never on another user.
-- Returns the organization id of the caller's first membership, creating the account
-- first if the caller has no membership at all.
-- Unlike the trigger it does NOT swallow errors: the caller must know when it failed.
create function public.ensure_my_account()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  return private.provision_account(
    v_user_id,
    (select u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = v_user_id)
  );
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase's default privileges also
-- grant EXECUTE to anon, authenticated and service_role. Remove all of that, then grant
-- to the one role that needs it.
revoke all on function public.ensure_my_account() from public, anon, authenticated, service_role;
grant execute on function public.ensure_my_account() to authenticated;
