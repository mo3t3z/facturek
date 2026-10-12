-- "Today" for legal dates is the date in Tunisia, not the database server's UTC date.
-- now() is the start of the current transaction, so the value is stable inside one call.
-- Not granted to the API roles: only finalize_document() (which runs as its owner) uses it.
create function private.today_tunis()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Tunis')::date;
$$;
revoke all on function private.today_tunis() from public;

-- finalize_document: the ONLY way a document leaves 'draft' and receives a number.
-- Frontend: supabase.rpc('finalize_document', { p_document_id })
--
-- SECURITY DEFINER: it runs with the rights of its owner so it can write the columns the
-- API role cannot (status, number, year, snapshots) and the document_counters table. That
-- is exactly why every check the API role would normally get from RLS is redone by hand
-- below, starting with organization membership.
--
-- Errors (custom SQLSTATE, see CLAUDE.md):
--   DF000 not authenticated                DF005 issue date is in the future
--   DF001 document not found (generic)     DF006 issue date earlier than the previous number
--   DF002 document is not a draft          DF007 timbre enabled but amount not configured
--   DF003 document has no client           DF008 due date is before the issue date
--   DF004 document has no items
create function public.finalize_document(p_document_id uuid)
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

  -- The only tax-related block: a facture cannot be issued while the organization says it
  -- applies the timbre but has not entered its amount. Everything else is allowed.
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
      timbre_fiscal = case when coalesce(v_tax.timbre_enabled, false) then v_tax.timbre_fiscal end,
      retenue_enabled = coalesce(v_tax.retenue_enabled, false),
      retenue_rate = v_tax.retenue_rate,
      retenue_threshold = v_tax.retenue_threshold
  where d.id = v_doc.id
  returning d.* into v_doc;

  return v_doc;
end;
$$;

-- Functions are executable by PUBLIC by default, and Supabase's default privileges also
-- grant EXECUTE to anon, authenticated and service_role. Remove all of that, then grant
-- to the one role that needs it.
revoke all on function public.finalize_document(uuid) from public, anon, authenticated, service_role;
grant execute on function public.finalize_document(uuid) to authenticated;
