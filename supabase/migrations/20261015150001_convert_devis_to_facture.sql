-- P2f. Converting an issued devis into a draft facture.
--
--   supabase.rpc('convert_devis_to_facture', { p_devis_id })
--
-- Decision (2026-10-15): ONE facture per devis. A unique index makes it true for every role;
-- the function checks it first so the caller gets a clear code (DF025) instead of 23505.
-- If the draft facture is deleted, the devis can be converted again: the index only counts
-- rows that exist.
--
-- What is copied: the client, the notes and every line (position, description, quantity,
-- unit price, TVA rate), into a NEW draft. Nothing else: the facture gets its own dates,
-- number, snapshots and totals when it is issued, from the tax settings of that day.
-- The draft stays editable like any other draft.
--
-- Atomic: the facture and its lines are written in one transaction, so a failure leaves
-- nothing behind. The devis is locked FOR UPDATE, so two conversions of the same devis at
-- the same instant end with one facture (the second one sees the first and gets DF025).
--
-- The rules that already exist keep applying: guard_document_conversion (DF013: only from a
-- devis that is neither a draft nor cancelled), guard_documents (DF021: a converted devis
-- cannot be cancelled).

create unique index documents_one_facture_per_devis
  on public.documents (organization_id, converted_from)
  where converted_from is not null;

create function public.convert_devis_to_facture(p_devis_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_devis public.documents;
  v_facture public.documents;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  -- Membership is part of the WHERE clause: a devis of another organization looks exactly
  -- like an id that does not exist (DF001).
  select d.* into v_devis
  from public.documents d
  where d.id = p_devis_id
    and private.is_org_member(d.organization_id)
  for update;

  if not found then
    raise exception 'document not found' using errcode = 'DF001';
  end if;

  if v_devis.type <> 'devis' or v_devis.status <> 'sent' then
    raise exception 'a facture can only be converted from a sent devis' using errcode = 'DF013';
  end if;

  if exists (
    select 1
    from public.documents f
    where f.organization_id = v_devis.organization_id
      and f.converted_from = v_devis.id
  ) then
    raise exception 'this devis was already converted into a facture' using errcode = 'DF025';
  end if;

  insert into public.documents (organization_id, type, client_id, notes, converted_from)
  values (v_devis.organization_id, 'facture', v_devis.client_id, v_devis.notes, v_devis.id)
  returning * into v_facture;

  insert into public.document_items (organization_id, document_id, position, description, quantity, unit_price, tva_rate)
  select i.organization_id, v_facture.id, i.position, i.description, i.quantity, i.unit_price, i.tva_rate
  from public.document_items i
  where i.organization_id = v_devis.organization_id
    and i.document_id = v_devis.id
  order by i.position, i.created_at, i.id;

  return v_facture;
end;
$$;

revoke all on function public.convert_devis_to_facture(uuid) from public, anon, authenticated, service_role;
grant execute on function public.convert_devis_to_facture(uuid) to authenticated;

notify pgrst, 'reload schema';
