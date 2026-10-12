-- Checkpoint C3: rules that must hold for EVERY role (API, service role, SQL editor).
-- RLS policies and column privileges only bind the API role; triggers and CHECK constraints
-- bind everyone. Custom SQLSTATE codes are listed in CLAUDE.md.

-- 1. An issued document is complete -----------------------------------------------------
-- Whatever path a document takes out of 'draft', it must carry what an issued document
-- needs. finalize_document() fills all of these; a manual UPDATE must too.
alter table public.documents
  add constraint documents_issued_is_complete check (
    status = 'draft'
    or (
      client_id is not null
      and issue_date is not null
      and number is not null
      and year is not null
      and seller_name is not null
      and buyer_name is not null
      and retenue_enabled is not null
    )
  );

-- 2. Helper for the guard triggers --------------------------------------------------------
-- BEFORE triggers run before RLS is checked on an INSERT. A trigger that looks at a parent
-- document could therefore tell a signed-in user something about another organization's
-- document ("it is not a draft") before RLS gets the chance to refuse the row. This helper
-- closes that door: a signed-in user who is not a member of the row's organization always
-- gets the same 42501, whatever the parent's state.
-- Callers without a user id (service role, SQL editor, migrations) are not affected; the
-- rules after this check apply to them in full.
create function private.reject_non_member(p_organization_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.is_org_member(p_organization_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.reject_non_member(uuid) from public, anon, authenticated, service_role;

-- 3. Immutability of issued documents -----------------------------------------------------
-- Once a document is no longer a draft:
--   * it cannot be deleted                                                   (DF010)
--   * no column may change except status (and updated_at, set by a trigger)  (DF011)
--   * status may only follow the transitions listed below                    (DF012)
create function private.guard_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text;
begin
  -- Allowed status transitions. Anything not listed is rejected, for every role.
  --   draft -> sent        any type. Safe to allow here: the CHECK above guarantees the
  --                        document is complete, and the API role cannot write status.
  --   sent  -> paid        facture only
  --   sent  -> cancelled   devis only
  -- Not allowed on purpose: paid -> sent, any return to draft, and cancelling a numbered
  -- facture (a numbered facture is corrected by a credit note, not erased).
  -- TODO(avoirs): credit notes are a later phase.
  -- TODO(accountant): have this transition map checked before real use.
  if tg_op = 'UPDATE' and new.status <> old.status and not (
    (old.status = 'draft' and new.status = 'sent')
    or (old.type = 'facture' and old.status = 'sent' and new.status = 'paid')
    or (old.type = 'devis' and old.status = 'sent' and new.status = 'cancelled')
  ) then
    raise exception 'status transition not allowed for a %: % -> %', old.type, old.status, new.status
      using errcode = 'DF012';
  end if;

  -- Drafts are freely editable and deletable (within constraints and privileges).
  if old.status = 'draft' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'a % document cannot be deleted', old.status using errcode = 'DF010';
  end if;

  -- Frozen content. Generic on purpose: the whole row is compared as JSON with only
  -- status and updated_at removed, so a column added by a future migration is frozen
  -- automatically.
  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    select string_agg(n.key, ', ' order by n.key) into v_changed
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('status', 'updated_at')
      and n.value is distinct from (to_jsonb(old) -> n.key);
    raise exception 'a % document is frozen; cannot change: %', old.status, v_changed
      using errcode = 'DF011';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_documents() from public, anon, authenticated, service_role;

create trigger guard_documents before update or delete on public.documents
  for each row execute function private.guard_documents();

-- 4. converted_from ---------------------------------------------------------------------
-- A facture may point at the devis it was made from: the document must be a facture, and
-- the source must be a devis that is neither a draft nor cancelled.              (DF013)
--
-- The rule is checked when the link is created or changed, not on every later update.
-- Otherwise cancelling the devis afterwards would block finalizing or paying a facture
-- whose link was valid when it was made.
create function private.guard_document_conversion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_type public.document_type;
  v_source_status public.document_status;
begin
  if tg_op = 'UPDATE'
    and new.converted_from is not distinct from old.converted_from
    and new.type = old.type
  then
    return new;
  end if;

  perform private.reject_non_member(new.organization_id);

  if new.type <> 'facture' then
    raise exception 'only a facture can be converted from another document' using errcode = 'DF013';
  end if;

  if new.converted_from = new.id then
    raise exception 'a document cannot be converted from itself' using errcode = 'DF013';
  end if;

  -- FOR SHARE: the source cannot be cancelled by another transaction while we look at it.
  select d.type, d.status into v_source_type, v_source_status
  from public.documents d
  where d.organization_id = new.organization_id
    and d.id = new.converted_from
  for share;

  -- No such document in this organization: the composite foreign key rejects the row
  -- right after this trigger with its usual error (23503).
  if not found then
    return new;
  end if;

  if v_source_type <> 'devis' or v_source_status in ('draft', 'cancelled') then
    raise exception 'a facture can only be converted from a devis that is neither a draft nor cancelled'
      using errcode = 'DF013';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_document_conversion() from public, anon, authenticated, service_role;

create trigger guard_document_conversion before insert or update on public.documents
  for each row
  when (new.converted_from is not null)
  execute function private.guard_document_conversion();
