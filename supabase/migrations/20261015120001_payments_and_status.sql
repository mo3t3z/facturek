-- P2e1. Payments and status (design: docs/p2e-design.md, decisions E-1 to E-7).
--
--   supabase.rpc('record_payment', { p_document_id, p_amount: "250.000", p_paid_at, p_method })
--   supabase.rpc('cancel_devis', { p_devis_id })
--
-- Two layers, as everywhere else:
--   * the API role can no longer insert a payment directly: record_payment() is its only path;
--   * the rules that protect the money are triggers, so they bind EVERY role:
--       DF018 the payments of a facture never exceed its net à payer   (guard_payments)
--       DF019 a facture is 'paid' only when its payments cover it      (guard_documents)
--       DF021 a devis with a converted facture cannot be cancelled     (guard_documents)
--     and 'paid' is set by a trigger when the last payment arrives, never by a click.
-- "Remaining" and "partly paid" are derived (net_a_payer - sum), never stored.
-- TODO(accountant): the paid_at rules. Nothing is checked on paid_at in P2e (decision E-6).

-- 1. The API role loses INSERT on payments (table and column privileges) and its policy.
revoke insert on public.payments from authenticated;
revoke insert (organization_id, document_id, amount, paid_at, method) on public.payments from authenticated;
drop policy payments_insert on public.payments;

-- 2. guard_payments: same rules as before, plus DF018. The document is now locked
-- FOR UPDATE, not FOR SHARE: with a shared lock two payments arriving together would both
-- read the old sum, both pass, and overpay the facture. With FOR UPDATE the second one
-- waits for the first to commit, then reads the new sum.
create or replace function private.guard_payments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.document_type;
  v_status public.document_status;
  v_net_a_payer numeric(12, 3);
  v_paid numeric;
begin
  if tg_op <> 'INSERT' then
    raise exception 'payments are append-only: a payment cannot be changed or deleted'
      using errcode = 'DF017';
  end if;

  perform private.reject_non_member(new.organization_id);

  select d.type, d.status, d.net_a_payer into v_type, v_status, v_net_a_payer
  from public.documents d
  where d.organization_id = new.organization_id
    and d.id = new.document_id
  for update;

  -- No such document in this organization: the composite foreign key rejects the row
  -- right after this trigger with its usual error (23503).
  if not found then
    return new;
  end if;

  if v_type <> 'facture' or v_status <> 'sent' then
    raise exception 'a payment can only be recorded on a sent facture' using errcode = 'DF016';
  end if;

  -- Compared with the net à payer (TTC + timbre): the client owes the timbre too.
  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p
  where p.organization_id = new.organization_id
    and p.document_id = new.document_id;

  if v_paid + new.amount > v_net_a_payer then
    raise exception 'payment exceeds the remaining amount' using errcode = 'DF018';
  end if;

  return new;
end;
$$;

-- 3. 'paid' when covered. AFTER INSERT, so the new payment is counted. The update goes
-- through guard_documents, which checks DF019 again: the two cannot disagree.
create function private.mark_paid_when_covered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.documents d
  set status = 'paid'
  where d.organization_id = new.organization_id
    and d.id = new.document_id
    and d.status = 'sent'
    and (
      select sum(p.amount)
      from public.payments p
      where p.organization_id = d.organization_id
        and p.document_id = d.id
    ) >= d.net_a_payer;
  return null;
end;
$$;

revoke all on function private.mark_paid_when_covered() from public, anon, authenticated, service_role;

create trigger mark_paid_when_covered
  after insert on public.payments
  for each row execute function private.mark_paid_when_covered();

-- 4. guard_documents: unchanged, plus DF019 and DF021 on the two transitions they guard.
create or replace function private.guard_documents()
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
  --   sent  -> paid        facture only, and only when its payments cover the net à payer
  --   sent  -> cancelled   devis only, and only when no facture was converted from it
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

  if tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'paid' and coalesce((
    select sum(p.amount)
    from public.payments p
    where p.organization_id = old.organization_id
      and p.document_id = old.id
  ), 0) < old.net_a_payer then
    raise exception 'a facture is paid only when its payments cover the net à payer'
      using errcode = 'DF019';
  end if;

  if tg_op = 'UPDATE' and old.status = 'sent' and new.status = 'cancelled' and exists (
    select 1
    from public.documents f
    where f.organization_id = old.organization_id
      and f.converted_from = old.id
  ) then
    raise exception 'a devis that a facture was converted from cannot be cancelled'
      using errcode = 'DF021';
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

-- 5. record_payment: the only API path to a payment.
-- The amount is TEXT in the exact form toDbNumeric() gives ("250.000"): a JSON number is a
-- float. Anything else, and zero, is refused with DF024 BEFORE it is cast, so no cast
-- error can be provoked. The rule on the sum (DF018) and 'paid' are in the triggers.
create function public.record_payment(
  p_document_id uuid,
  p_amount text,
  p_paid_at date,
  p_method public.payment_method
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documents;
  v_payment public.payments;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  -- Membership is part of the WHERE clause: a document of another organization looks
  -- exactly like an id that does not exist (DF001). Locked like guard_payments will.
  select d.* into v_doc
  from public.documents d
  where d.id = p_document_id
    and private.is_org_member(d.organization_id)
  for update;

  if not found then
    raise exception 'document not found' using errcode = 'DF001';
  end if;

  if v_doc.type <> 'facture' or v_doc.status <> 'sent' then
    raise exception 'a payment can only be recorded on a sent facture' using errcode = 'DF016';
  end if;

  if p_amount is null
    or p_amount !~ '^[0-9]{1,9}\.[0-9]{3}$'
    or p_amount::numeric(12, 3) = 0
  then
    raise exception 'amount must be a positive text with 3 decimals' using errcode = 'DF024';
  end if;

  if p_paid_at is null or p_method is null then
    raise exception 'paid_at and method are required' using errcode = '23502';
  end if;

  insert into public.payments (organization_id, document_id, amount, paid_at, method)
  values (v_doc.organization_id, v_doc.id, p_amount::numeric(12, 3), p_paid_at, p_method)
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke all on function public.record_payment(uuid, text, date, public.payment_method) from public, anon, authenticated, service_role;
grant execute on function public.record_payment(uuid, text, date, public.payment_method) to authenticated;

-- 6. cancel_devis: the only API path to 'cancelled'. DF021 is checked by guard_documents.
create function public.cancel_devis(p_devis_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documents;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  select d.* into v_doc
  from public.documents d
  where d.id = p_devis_id
    and private.is_org_member(d.organization_id)
  for update;

  if not found then
    raise exception 'document not found' using errcode = 'DF001';
  end if;

  if v_doc.type <> 'devis' or v_doc.status <> 'sent' then
    raise exception 'only a sent devis can be cancelled' using errcode = 'DF012';
  end if;

  update public.documents d
  set status = 'cancelled'
  where d.id = v_doc.id
  returning d.* into v_doc;

  return v_doc;
end;
$$;

revoke all on function public.cancel_devis(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_devis(uuid) to authenticated;

notify pgrst, 'reload schema';
