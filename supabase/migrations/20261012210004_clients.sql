create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  matricule_fiscal text,
  address text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of composite foreign keys: guarantees a document's client is in the same org.
  unique (organization_id, id)
);
create index clients_organization_id_idx on public.clients (organization_id);

alter table public.clients enable row level security;
revoke all on table public.clients from anon, authenticated;
grant select, insert, delete on table public.clients to authenticated;
grant update (name, matricule_fiscal, address, email, phone) on table public.clients to authenticated;

create trigger set_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger prevent_organization_change before update on public.clients
  for each row execute function private.prevent_organization_change();
