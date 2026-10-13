-- P2d2a, 1/6. An organization that says it applies the timbre fiscal must have entered its
-- amount. The settings form already refuses the opposite; this CHECK is the layer that
-- binds EVERY role (service role, SQL editor), like every rule that an issued document
-- depends on. finalize_document() keeps its own refusal (DF007) as a second line of defence.
-- Verified before writing this migration: 0 row of the local database violates it.
-- TODO(accountant): confirm when the timbre fiscal applies. No amount is assumed here.
alter table public.tax_settings
  add constraint tax_settings_timbre_enabled_has_amount
  check (not timbre_enabled or timbre_fiscal is not null);
