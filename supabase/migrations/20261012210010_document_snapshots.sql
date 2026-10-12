-- 1. tax_settings.timbre_enabled -----------------------------------------------------------
-- A switch, not a tax value: it says whether the organization applies the timbre fiscal.
-- The amount itself stays in timbre_fiscal, which has no default.
-- TODO(accountant): confirm when the timbre fiscal applies before relying on this switch.
alter table public.tax_settings
  add column timbre_enabled boolean not null default false;

grant update (timbre_enabled) on table public.tax_settings to authenticated;

-- 2. Snapshot columns on documents --------------------------------------------------------
-- Copied by public.finalize_document() at the moment a document is issued, so that later
-- edits to the organization, the client or tax_settings never change an issued document.
-- All NULL while the document is a draft.
--
-- No GRANT follows, on purpose: INSERT and UPDATE privileges on documents are granted per
-- column, so the API role cannot write any of these columns. (SELECT is granted on the
-- whole table and therefore covers them.)
alter table public.documents
  -- Seller: copied from organizations.
  add column seller_name text,
  add column seller_matricule_fiscal text,
  add column seller_address text,
  -- Buyer: copied from clients.
  add column buyer_name text,
  add column buyer_matricule_fiscal text,
  add column buyer_address text,
  -- Tax settings in force when the document was issued: copied from tax_settings.
  -- timbre_fiscal is NULL when the timbre was not enabled (or had no amount) at that moment.
  -- Totals are computed in a later phase; nothing here decides what is charged.
  add column timbre_fiscal numeric(12, 3),
  add column retenue_enabled boolean,
  add column retenue_rate numeric(6, 3),
  add column retenue_threshold numeric(12, 3);
