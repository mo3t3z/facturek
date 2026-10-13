-- P2d2b. finalize_document v2: the caller states the net à payer the user confirmed.
--
--   supabase.rpc('finalize_document', { p_document_id, p_expected_net_a_payer: "1190.600" })
--
-- Why: the totals shown on the screen are computed in the browser, the totals stored on
-- the document are computed here. If they differ (a line or the tax settings changed in
-- another tab, a bug in either implementation), a document would be issued, numbered and
-- frozen for an amount the user never saw. Now nothing is issued unless both agree.
--
-- The second parameter is REQUIRED: no default, no overload. The old one-argument
-- function is DROPPED (CREATE OR REPLACE with another argument list would have created a
-- second function and left the unchecked one callable). A client that still sends one
-- argument gets PGRST202 (function not found): it fails closed.
--
-- Three new checks, after DF007 and BEFORE the counter is touched, so a refused call
-- consumes no number and does not even take the counter lock:
--   DF023 total exceeds the maximum   net à payer above numeric(12,3)
--   DF022 total is zero               total_ttc (HT + TVA) = 0
--   DF009 expected total differs      p_expected_net_a_payer is not the text of the net à payer
-- DF000 to DF008 are unchanged, in the same order (DF006 still comes after the counter is
-- locked, on purpose).
--
-- The amounts come from private.compute_totals(), the only place that knows the rule:
-- this function contains no arithmetic of its own.
-- TODO(accountant): the rule itself, and the refusal of a zero total.
drop function public.finalize_document(uuid);

create function public.finalize_document(p_document_id uuid, p_expected_net_a_payer text)
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
  v_timbre numeric(12, 3);
  v_total_ttc numeric;
  v_net_a_payer numeric;
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

  -- The timbre that WILL be snapshotted below: the organization's amount for a facture of
  -- an organization that applies it, nothing otherwise (never on a devis).
  v_timbre := case
    when v_doc.type = 'facture' and coalesce(v_tax.timbre_enabled, false) then v_tax.timbre_fiscal
  end;

  -- The totals of the document as it is now. The document is locked FOR UPDATE above, and
  -- every write on its lines takes FOR SHARE on it first (guard_document_items), so the
  -- lines cannot change between this computation and the UPDATE that issues the document:
  -- the trigger set_document_totals will store exactly these values.
  select t.total_ttc, t.net_a_payer into v_total_ttc, v_net_a_payer
  from private.compute_totals(
    (
      select array_agg(row(i.quantity, i.unit_price, i.tva_rate)::private.document_line)
      from public.document_items i
      where i.organization_id = v_doc.organization_id
        and i.document_id = v_doc.id
    ),
    v_timbre
  ) t;

  -- 999999999.999 is the largest value of numeric(12,3), the type of every stored amount.
  -- No amount is negative, so if anything is too large the net à payer is.
  if v_net_a_payer > 999999999.999 then
    raise exception 'total exceeds the maximum' using errcode = 'DF023';
  end if;

  -- On total_ttc (HT + TVA), not on the net à payer: a facture of zero plus a timbre is
  -- refused too. TODO(accountant): is a facture with a total of zero ever legitimate?
  if v_total_ttc = 0 then
    raise exception 'total is zero' using errcode = 'DF022';
  end if;

  -- The amount the user confirmed must be the amount that is about to be stored.
  -- Compared AS TEXT, in the exact form Postgres prints a numeric(12,3) ("1190.600").
  -- The caller's text is never cast to a number: NULL, "1190.6", "1e3", " 1190.600" or
  -- garbage are all simply different, and no cast error can be provoked.
  if p_expected_net_a_payer is distinct from v_net_a_payer::numeric(12, 3)::text then
    raise exception 'expected total differs from the computed total' using errcode = 'DF009';
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
      timbre_fiscal = v_timbre,
      retenue_enabled = coalesce(v_tax.retenue_enabled, false),
      retenue_rate = v_tax.retenue_rate,
      retenue_threshold = v_tax.retenue_threshold
  where d.id = v_doc.id
  returning d.* into v_doc;

  return v_doc;
end;
$$;

-- A new function gets the default privileges again (EXECUTE for PUBLIC, and Supabase's
-- grants to anon, authenticated and service_role). Remove all of that, then grant to the
-- one role that needs it.
revoke all on function public.finalize_document(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.finalize_document(uuid, text) to authenticated;

-- PostgREST caches the list of functions: make it forget the old signature now.
notify pgrst, 'reload schema';
