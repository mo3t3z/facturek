-- Documents (devis and factures), their line items and payments: tables, constraints and
-- privileges. RLS policies are in the next migration.
-- Out of scope here, on purpose (later checkpoints): numbering (document_counters,
-- finalize_document) and the immutability / payment-rule triggers.

create type public.document_type as enum ('devis', 'facture');
-- No 'overdue' status: it is derived from due_date and payments, never stored.
create type public.document_status as enum ('draft', 'sent', 'paid', 'cancelled');
create type public.payment_method as enum ('cash', 'virement', 'cheque');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: an organization that has issued documents cannot simply be deleted.
  organization_id uuid not null references public.organizations (id) on delete restrict,
  type public.document_type not null,
  -- number and year stay NULL while the document is a draft. They will be assigned by a
  -- SECURITY DEFINER function in a later checkpoint, never by the API role.
  number integer check (number > 0),
  year integer,
  status public.document_status not null default 'draft',
  client_id uuid,
  issue_date date,
  due_date date,
  currency text not null default 'TND',
  notes text,
  converted_from uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Target of the composite foreign keys of items, payments and converted_from.
  constraint documents_org_id_key unique (organization_id, id),
  constraint documents_number_key unique (organization_id, type, year, number),

  -- Same-organization guarantees. MATCH SIMPLE (the default): the key is not checked
  -- while the nullable column is NULL, and organization_id itself is NOT NULL.
  constraint documents_client_fk foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete restrict,
  constraint documents_converted_from_fk foreign key (organization_id, converted_from)
    references public.documents (organization_id, id) on delete restrict,

  -- A document can only leave 'draft' with a number.
  constraint documents_numbered_unless_draft check (status = 'draft' or number is not null),
  constraint documents_number_year_together check ((number is null) = (year is null)),
  constraint documents_due_after_issue check (
    due_date is null or issue_date is null or due_date >= issue_date
  )
);
create index documents_organization_id_idx on public.documents (organization_id);
create index documents_client_idx on public.documents (organization_id, client_id);
create index documents_converted_from_idx on public.documents (organization_id, converted_from);

create table public.document_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  position integer not null default 0 check (position >= 0),
  description text not null check (length(trim(description)) > 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 3) not null check (unit_price >= 0),
  -- No default: the rate always comes from the caller (pre-filled from tax_settings).
  tva_rate numeric(6, 3) not null check (tva_rate between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The item's organization is always its document's organization.
  -- CASCADE: deleting a (draft) document deletes its items.
  constraint document_items_document_fk foreign key (organization_id, document_id)
    references public.documents (organization_id, id) on delete cascade
);
create index document_items_document_idx on public.document_items (organization_id, document_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  amount numeric(12, 3) not null check (amount > 0),
  paid_at date not null,
  method public.payment_method not null,
  created_at timestamptz not null default now(),
  -- RESTRICT: a document that has payments cannot be deleted.
  constraint payments_document_fk foreign key (organization_id, document_id)
    references public.documents (organization_id, id) on delete restrict
);
create index payments_document_idx on public.payments (organization_id, document_id);

-- Deny by default.
alter table public.documents enable row level security;
alter table public.document_items enable row level security;
alter table public.payments enable row level security;

revoke all on table public.documents from anon, authenticated;
revoke all on table public.document_items from anon, authenticated;
revoke all on table public.payments from anon, authenticated;

-- Column privileges are the first line of defence around numbering and status:
-- the API role cannot name status, number, year, currency or id in an INSERT, and cannot
-- update status, number, year, type, currency, id or organization_id at all.
-- Status changes will only happen through SECURITY DEFINER functions.
grant select, delete on table public.documents to authenticated;
grant insert (organization_id, type, client_id, issue_date, due_date, notes, converted_from)
  on table public.documents to authenticated;
grant update (client_id, issue_date, due_date, notes, converted_from)
  on table public.documents to authenticated;

grant select, delete on table public.document_items to authenticated;
grant insert (organization_id, document_id, position, description, quantity, unit_price, tva_rate)
  on table public.document_items to authenticated;
grant update (position, description, quantity, unit_price, tva_rate)
  on table public.document_items to authenticated;

-- Payments are append-only from the API: no UPDATE, no DELETE.
grant select on table public.payments to authenticated;
grant insert (organization_id, document_id, amount, paid_at, method)
  on table public.payments to authenticated;

create trigger set_updated_at before update on public.documents
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.document_items
  for each row execute function private.set_updated_at();
