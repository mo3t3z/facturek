-- RLS policies for documents, document_items and payments.
-- Every policy is `to authenticated`; anon matches nothing and has no privileges.
--
--   documents      : members read and insert; UPDATE and DELETE only while status = 'draft'
--   document_items : members read; INSERT/UPDATE/DELETE only while the parent is a draft
--   payments       : members read; INSERT only on a sent facture; no UPDATE/DELETE

-- documents -----------------------------------------------------------------------------
create policy documents_select on public.documents
  for select to authenticated using (private.is_org_member(organization_id));

create policy documents_insert on public.documents
  for insert to authenticated with check (private.is_org_member(organization_id));

-- Only drafts can be edited from the API. USING is evaluated on the existing row, so a
-- non-draft document simply matches no row. (Status itself is not writable by the API
-- role, so an edited draft is still a draft.)
create policy documents_update on public.documents
  for update to authenticated
  using (private.is_org_member(organization_id) and status = 'draft')
  with check (private.is_org_member(organization_id));

create policy documents_delete on public.documents
  for delete to authenticated
  using (private.is_org_member(organization_id) and status = 'draft');

-- document_items ------------------------------------------------------------------------
-- The composite foreign key guarantees organization_id IS the parent document's, so
-- membership of organization_id is membership of the parent's organization.
create policy document_items_select on public.document_items
  for select to authenticated using (private.is_org_member(organization_id));

-- Writes additionally require the parent document to be a draft. The sub-select runs with
-- the caller's own rights, so it can only ever see documents of their organizations.
create policy document_items_insert on public.document_items
  for insert to authenticated
  with check (
    private.is_org_member(organization_id)
    and exists (
      select 1
      from public.documents d
      where d.id = document_items.document_id
        and d.organization_id = document_items.organization_id
        and d.status = 'draft'
    )
  );

create policy document_items_update on public.document_items
  for update to authenticated
  using (
    private.is_org_member(organization_id)
    and exists (
      select 1
      from public.documents d
      where d.id = document_items.document_id
        and d.organization_id = document_items.organization_id
        and d.status = 'draft'
    )
  )
  with check (
    private.is_org_member(organization_id)
    and exists (
      select 1
      from public.documents d
      where d.id = document_items.document_id
        and d.organization_id = document_items.organization_id
        and d.status = 'draft'
    )
  );

create policy document_items_delete on public.document_items
  for delete to authenticated
  using (
    private.is_org_member(organization_id)
    and exists (
      select 1
      from public.documents d
      where d.id = document_items.document_id
        and d.organization_id = document_items.organization_id
        and d.status = 'draft'
    )
  );

-- payments ------------------------------------------------------------------------------
-- No update/delete policy (and no such privilege): payments are append-only from the API.
create policy payments_select on public.payments
  for select to authenticated using (private.is_org_member(organization_id));

-- A payment can only be recorded on a facture whose status is exactly 'sent': not a draft,
-- not already paid, not cancelled.
-- This policy binds the API role. The guard_payments trigger enforces the same rule for
-- every role and locks the parent row against concurrent changes.
create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    private.is_org_member(organization_id)
    and exists (
      select 1
      from public.documents d
      where d.id = payments.document_id
        and d.organization_id = payments.organization_id
        and d.type = 'facture'
        and d.status = 'sent'
    )
  );
