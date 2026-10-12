-- One row per organization. Every value starts NULL: nothing is assumed.
-- TODO(accountant): timbre fiscal amount, TVA rates and retenue à la source rules/thresholds
-- must be verified with an accountant or an official source (loi de finances) before real
-- use. No rate or amount may be hardcoded in code or migrations.
create table public.tax_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  default_tva_rate numeric(6, 3) check (default_tva_rate between 0 and 100),
  timbre_fiscal numeric(12, 3) check (timbre_fiscal >= 0),
  retenue_enabled boolean not null default false,
  retenue_rate numeric(6, 3) check (retenue_rate between 0 and 100),
  retenue_threshold numeric(12, 3) check (retenue_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tax_settings enable row level security;
revoke all on table public.tax_settings from anon, authenticated;
grant select on table public.tax_settings to authenticated;
grant update (default_tva_rate, timbre_fiscal, retenue_enabled, retenue_rate, retenue_threshold)
  on table public.tax_settings to authenticated;

create trigger set_updated_at before update on public.tax_settings
  for each row execute function private.set_updated_at();
