-- P2d2a, 4/6. The stored totals of an issued document.
--
-- A draft stores NO total: its totals are a preview computed in the browser. The totals
-- are written once, when the document leaves 'draft' (trigger of the next migration), and
-- are then frozen by private.guard_documents(), which freezes every column of a non-draft
-- document except status and updated_at.
--
-- Meaning of each stored amount (no value can be read two ways; TODO(accountant)):
--   total_ht       sum of the rounded line totals
--   total_tva      sum of the TVA of each rate
--   total_ttc      total_ht + total_tva                        NEVER the timbre
--   timbre_fiscal  (existing snapshot) the droit de timbre charged; NULL = none
--   net_a_payer    total_ttc + coalesce(timbre_fiscal, 0)      what the client owes
--   tva_breakdown  per-rate table, amounts as text (see private.compute_totals)
-- On a devis timbre_fiscal is always NULL, so net_a_payer = total_ttc.
-- The retenue à la source is NOT part of any of these amounts (docs/phase2-plan.md,
-- decision 2).
--
-- No GRANT follows, on purpose: INSERT and UPDATE on documents are granted per column, so
-- the API role cannot write these columns; SELECT is granted on the whole table and
-- therefore covers them.
alter table public.documents
  add column total_ht numeric(12, 3),
  add column total_tva numeric(12, 3),
  add column total_ttc numeric(12, 3),
  add column net_a_payer numeric(12, 3),
  add column tva_breakdown jsonb;

alter table public.documents
  -- A draft carries no total, for every role.
  add constraint documents_draft_has_no_totals check (
    status <> 'draft'
    or (
      total_ht is null
      and total_tva is null
      and total_ttc is null
      and net_a_payer is null
      and tva_breakdown is null
    )
  ),
  -- The timbre fiscal is charged on factures only, never on a devis.
  add constraint documents_devis_has_no_timbre check (type <> 'devis' or timbre_fiscal is null),
  -- tax_settings.timbre_fiscal has this CHECK; its snapshot did not.
  add constraint documents_timbre_fiscal_not_negative check (timbre_fiscal >= 0),
  add constraint documents_totals_not_negative check (total_ht >= 0 and total_tva >= 0),
  -- These two make the column names true, whoever writes the row.
  add constraint documents_total_ttc_is_ht_plus_tva check (total_ttc = total_ht + total_tva),
  add constraint documents_net_a_payer_is_ttc_plus_timbre check (
    net_a_payer = total_ttc + coalesce(timbre_fiscal, 0)
  ),
  add constraint documents_tva_breakdown_is_array check (jsonb_typeof(tva_breakdown) = 'array');

-- An issued document is complete: the seven fields required until now, plus the totals.
-- A CHECK cannot be altered, so it is dropped and created again in the same statement.
-- If a non-draft document without totals existed, this would fail and stop the migration:
-- the totals of an already issued document must never be invented silently.
-- (Verified before writing this migration: the local database has no non-draft document.)
alter table public.documents
  drop constraint documents_issued_is_complete,
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
      and total_ht is not null
      and total_tva is not null
      and total_ttc is not null
      and net_a_payer is not null
      and tva_breakdown is not null
    )
  );
