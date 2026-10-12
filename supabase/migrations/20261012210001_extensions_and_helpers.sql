-- Private schema: functions used by RLS policies and triggers.
-- It is NOT listed in the API schemas (config.toml), so nothing here is callable via RPC.
create schema if not exists private;
revoke all on schema private from public;
-- Policies run as the querying role, so `authenticated` must be able to resolve the helpers.
grant usage on schema private to authenticated, service_role;

-- Custom SQLSTATE codes raised by this project (the frontend maps them to i18n messages):
--   DF020 membership rule violated
--   DF040 organization_id cannot be changed

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.prevent_organization_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id cannot be changed' using errcode = 'DF040';
  end if;
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
revoke all on function private.prevent_organization_change() from public;
