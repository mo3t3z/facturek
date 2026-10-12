-- RLS policies for the tenancy tables, clients and tax_settings.
-- RLS itself was enabled when each table was created.
-- Every policy is `to authenticated`: the anon role matches no policy and has no table
-- privileges, so it can read and write nothing.
--
-- Role matrix
--   member : read org data; write clients
--   admin  : member + tax_settings + remove plain members (not admins, not owners)
--   owner  : admin + organization details + change any role + remove anyone
-- Anyone may leave an organization (delete their own membership).
-- Nobody can INSERT a membership from the API.
-- The "last owner" rule depends on other rows, so it lives in a trigger, not here.

-- organizations -------------------------------------------------------------------------
-- No insert/delete policy: organizations are not created from the API in phase 1.
create policy organizations_select on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (private.has_org_role(id, array['owner']::public.org_role[]))
  with check (private.has_org_role(id, array['owner']::public.org_role[]));

-- profiles ------------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organization_members ------------------------------------------------------------------
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

-- No insert policy (and no INSERT privilege): nobody can add a membership from the API, not
-- even an owner. Otherwise any user could be pulled into an organization without consent.

-- Role changes: owners only, for the existing row (USING) and the new row (WITH CHECK).
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner']::public.org_role[]))
  with check (private.has_org_role(organization_id, array['owner']::public.org_role[]));

-- Removal: an owner may remove anyone; an admin may remove plain members only; anyone may
-- leave (their own row). The last-owner trigger still applies to all three cases.
create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner']::public.org_role[])
    or (
      private.has_org_role(organization_id, array['admin']::public.org_role[])
      and role = 'member'
    )
    or user_id = (select auth.uid())
  );

-- clients -------------------------------------------------------------------------------
create policy clients_select on public.clients
  for select to authenticated using (private.is_org_member(organization_id));
create policy clients_insert on public.clients
  for insert to authenticated with check (private.is_org_member(organization_id));
create policy clients_update on public.clients
  for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy clients_delete on public.clients
  for delete to authenticated using (private.is_org_member(organization_id));

-- tax_settings --------------------------------------------------------------------------
-- No insert/delete policy: the row is created together with the organization.
create policy tax_settings_select on public.tax_settings
  for select to authenticated using (private.is_org_member(organization_id));
create policy tax_settings_update on public.tax_settings
  for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
