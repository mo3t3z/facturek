-- Last number handed out per (organization, document type, year).
-- Only public.finalize_document() reads or writes this table.
--
-- Why a counter table and not a sequence or max(number) + 1:
--   * a sequence never rolls back, so a failed transaction would leave a gap;
--   * max(number) + 1 lets two concurrent transactions compute the same number.
-- A counter ROW is locked by the transaction that increments it and the increment is undone
-- if that transaction rolls back: no duplicate and no gap.
create table public.document_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type public.document_type not null,
  year integer not null,
  last_number integer not null check (last_number > 0),
  primary key (organization_id, type, year)
);

-- RLS on with NO policy, and no privilege at all for the API roles: the table is invisible
-- and untouchable from the API. finalize_document() is SECURITY DEFINER and runs as the
-- table owner, which is not subject to RLS.
alter table public.document_counters enable row level security;
revoke all on table public.document_counters from public, anon, authenticated;
