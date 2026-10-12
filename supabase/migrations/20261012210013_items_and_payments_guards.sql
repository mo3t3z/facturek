-- Guards on document_items and payments, for every role.
--
-- Both look at the parent document with SELECT ... FOR SHARE. That row lock is what closes
-- the race with finalize_document(), which takes FOR UPDATE on the same row:
--   * the item write gets its lock first -> finalize waits for it and then counts it;
--   * finalize gets its lock first       -> the item write waits, then reads 'sent' and
--                                           is rejected.
-- Without the lock a write could read 'draft' while finalize is still uncommitted and land
-- in a document that has just been issued.

-- 1. document_items -----------------------------------------------------------------------
--   * items can only be inserted, updated or deleted while the parent is a draft  (DF014)
--   * an item can never be moved to another document or organization              (DF015)
create function private.guard_document_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_document_id uuid;
  v_status public.document_status;
begin
  if tg_op = 'UPDATE'
    and (new.document_id <> old.document_id or new.organization_id <> old.organization_id)
  then
    raise exception 'an item cannot be moved to another document or organization'
      using errcode = 'DF015';
  end if;

  if tg_op = 'INSERT' then
    perform private.reject_non_member(new.organization_id);
    v_organization_id := new.organization_id;
    v_document_id := new.document_id;
  else
    v_organization_id := old.organization_id;
    v_document_id := old.document_id;
  end if;

  select d.status into v_status
  from public.documents d
  where d.organization_id = v_organization_id
    and d.id = v_document_id
  for share;

  if not found then
    -- DELETE: the parent draft is being deleted in this same transaction and this is the
    -- foreign-key cascade removing its items. The parent row is already gone, so there is
    -- nothing to protect: let the cascade through. (A non-draft parent can never get this
    -- far: guard_documents rejects its deletion before any cascade starts.)
    if tg_op = 'DELETE' then
      return old;
    end if;
    -- INSERT: no such document in this organization. The composite foreign key rejects
    -- the row right after this trigger with its usual error (23503).
    return new;
  end if;

  if v_status <> 'draft' then
    raise exception 'the items of a % document cannot be changed', v_status using errcode = 'DF014';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_document_items() from public, anon, authenticated, service_role;

create trigger guard_document_items before insert or update or delete on public.document_items
  for each row execute function private.guard_document_items();

-- 2. payments -----------------------------------------------------------------------------
--   * a payment can only be recorded on a facture whose status is 'sent'   (DF016)
--   * payments are append-only: no UPDATE, no DELETE, for anyone           (DF017)
-- A mistake is corrected by a reversal entry (later phase), never by editing history.
create function private.guard_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.document_type;
  v_status public.document_status;
begin
  if tg_op <> 'INSERT' then
    raise exception 'payments are append-only: a payment cannot be changed or deleted'
      using errcode = 'DF017';
  end if;

  perform private.reject_non_member(new.organization_id);

  select d.type, d.status into v_type, v_status
  from public.documents d
  where d.organization_id = new.organization_id
    and d.id = new.document_id
  for share;

  -- No such document in this organization: the composite foreign key rejects the row
  -- right after this trigger with its usual error (23503).
  if not found then
    return new;
  end if;

  if v_type <> 'facture' or v_status <> 'sent' then
    raise exception 'a payment can only be recorded on a sent facture' using errcode = 'DF016';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_payments() from public, anon, authenticated, service_role;

create trigger guard_payments before insert or update or delete on public.payments
  for each row execute function private.guard_payments();
