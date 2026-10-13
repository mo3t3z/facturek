-- P2d2a, 6/6. finalize_document(): the timbre fiscal is snapshotted on FACTURES only.
--
-- Until now the snapshot looked only at tax_settings.timbre_enabled, so a devis of an
-- organization that applies the timbre received its amount in documents.timbre_fiscal.
-- The CHECK documents_devis_has_no_timbre (migration 4/6) now forbids that for every
-- role, so the body is corrected in the same step.
-- TODO(accountant): confirm that the timbre fiscal never applies to a devis.
--
-- CREATE OR REPLACE with the SAME signature (uuid): the function keeps its owner and its
-- privileges (EXECUTE for authenticated only), so no REVOKE / GRANT follows. Only two
-- things differ from 20261012210011: the timbre expression in the final UPDATE, and the
-- comment above the DF007 block. Nothing else changes: no expected-total parameter and no
-- new error code yet (P2d2b).
--
-- The totals columns are not set here: the trigger set_document_totals (migration 5/6)
-- writes them during the UPDATE below, from the lines and from the timbre snapshotted in
-- that same UPDATE.
--
-- Errors (custom SQLSTATE, see CLAUDE.md): unchanged, DF000 to DF008.
create or replace function public.finalize_document(p_document_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documents;
  v_org public.organizations;
  v_client public.clients;
  v_tax public.tax_settings;
  v_today date := private.today_tunis();
  v_issue_date date;
  v_year integer;
  v_number integer;
  v_previous_issue_date date;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'DF000';
  end if;

  -- Lock the document so two calls for the same document cannot both finalize it: the
  -- second one waits here, then sees status = 'sent' and fails with DF002.
  -- Membership is part of the WHERE clause: a document of another organization is neither
  -- returned nor locked, and looks exactly like an id that does not exist.
  select d.* into v_doc
  from public.documents d
  where d.id = p_document_id
    and private.is_org_member(d.organization_id)
  for update;

  if not found then
    raise exception 'document not found' using errcode = 'DF001';
  end if;

  if v_doc.status <> 'draft' then
    raise exception 'document is not a draft' using errcode = 'DF002';
  end if;

  if v_doc.client_id is null then
    raise exception 'document has no client' using errcode = 'DF003';
  end if;

  if not exists (
    select 1
    from public.document_items i
    where i.organization_id = v_doc.organization_id
      and i.document_id = v_doc.id
  ) then
    raise exception 'document has no items' using errcode = 'DF004';
  end if;

  -- TODO(accountant): the two date rules below (no future date; dates follow numbers) are
  -- our reading of "chronological, uninterrupted numbering". Verify both before real use.
  v_issue_date := coalesce(v_doc.issue_date, v_today);
  if v_issue_date > v_today then
    raise exception 'issue date is in the future' using errcode = 'DF005';
  end if;

  if v_doc.due_date is not null and v_doc.due_date < v_issue_date then
    raise exception 'due date is before the issue date' using errcode = 'DF008';
  end if;

  v_year := extract(year from v_issue_date)::integer;

  select o.* into strict v_org
  from public.organizations o
  where o.id = v_doc.organization_id;

  select c.* into strict v_client
  from public.clients c
  where c.organization_id = v_doc.organization_id
    and c.id = v_doc.client_id;

  -- No STRICT: an organization without a tax_settings row is treated as "nothing enabled".
  select t.* into v_tax
  from public.tax_settings t
  where t.organization_id = v_doc.organization_id;

  -- A facture cannot be issued while the organization says it applies the timbre but has
  -- not entered its amount. The CHECK tax_settings_timbre_enabled_has_amount now makes
  -- that state impossible; this refusal stays as a second line of defence.
  if v_doc.type = 'facture'
    and coalesce(v_tax.timbre_enabled, false)
    and v_tax.timbre_fiscal is null
  then
    raise exception 'timbre fiscal is enabled but its amount is not configured'
      using errcode = 'DF007';
  end if;

  -- Take the next number. This single statement creates the counter row or increments it,
  -- and keeps it locked until this transaction ends: a concurrent finalize for the same
  -- (organization, type, year) waits here. If anything fails after this point the whole
  -- transaction rolls back, increment included, so no number is ever skipped.
  insert into public.document_counters as c (organization_id, type, year, last_number)
  values (v_doc.organization_id, v_doc.type, v_year, 1)
  on conflict (organization_id, type, year)
  do update set last_number = c.last_number + 1
  returning c.last_number into v_number;

  -- Numbers and dates must stay in the same order. This check comes AFTER the counter is
  -- locked on purpose: only now is "the latest numbered document" guaranteed not to change
  -- under us. A failure here undoes the increment above.
  select d.issue_date into v_previous_issue_date
  from public.documents d
  where d.organization_id = v_doc.organization_id
    and d.type = v_doc.type
    and d.year = v_year
  order by d.number desc
  limit 1;

  if v_previous_issue_date is not null and v_issue_date < v_previous_issue_date then
    raise exception 'issue date is earlier than the previous document of the same series'
      using errcode = 'DF006';
  end if;

  update public.documents d
  set status = 'sent',
      number = v_number,
      year = v_year,
      issue_date = v_issue_date,
      seller_name = v_org.name,
      seller_matricule_fiscal = v_org.matricule_fiscal,
      seller_address = v_org.address,
      buyer_name = v_client.name,
      buyer_matricule_fiscal = v_client.matricule_fiscal,
      buyer_address = v_client.address,
      -- Factures only: a devis never carries the timbre (CHECK documents_devis_has_no_timbre).
      timbre_fiscal = case
        when v_doc.type = 'facture' and coalesce(v_tax.timbre_enabled, false) then v_tax.timbre_fiscal
      end,
      retenue_enabled = coalesce(v_tax.retenue_enabled, false),
      retenue_rate = v_tax.retenue_rate,
      retenue_threshold = v_tax.retenue_threshold
  where d.id = v_doc.id
  returning d.* into v_doc;

  return v_doc;
end;
$$;
