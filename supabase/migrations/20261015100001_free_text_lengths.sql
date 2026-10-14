-- Sprint 8. Length limits on every free-text column, the same as the screens
-- (Zod schemas in src/features/clients, settings, documents and auth). Until now only the
-- screens knew them; a direct API call could store any length.
-- length() counts characters, JavaScript .length counts UTF-16 units (an emoji counts 2
-- there), so the screen is never more permissive than the database.
-- The snapshot columns of documents take the limits of the column they are copied from
-- (organizations -> seller_*, clients -> buyer_*), so finalize_document() never fails on them.
-- Verified before writing this migration: 0 row of the local database violates them (the
-- longest value is 48 characters).
-- The line description already has its limit (document_items_description_length, 500).
-- documents.currency is not free text: it is left alone.

alter table public.organizations
  add constraint organizations_name_length check (length(name) <= 200),
  add constraint organizations_matricule_fiscal_length check (length(matricule_fiscal) <= 50),
  add constraint organizations_address_length check (length(address) <= 500),
  add constraint organizations_email_length check (length(email) <= 254),
  add constraint organizations_phone_length check (length(phone) <= 30);

alter table public.clients
  add constraint clients_name_length check (length(name) <= 200),
  add constraint clients_matricule_fiscal_length check (length(matricule_fiscal) <= 50),
  add constraint clients_address_length check (length(address) <= 500),
  add constraint clients_email_length check (length(email) <= 254),
  add constraint clients_phone_length check (length(phone) <= 30);

alter table public.documents
  add constraint documents_notes_length check (length(notes) <= 2000),
  add constraint documents_seller_name_length check (length(seller_name) <= 200),
  add constraint documents_seller_matricule_fiscal_length check (length(seller_matricule_fiscal) <= 50),
  add constraint documents_seller_address_length check (length(seller_address) <= 500),
  add constraint documents_buyer_name_length check (length(buyer_name) <= 200),
  add constraint documents_buyer_matricule_fiscal_length check (length(buyer_matricule_fiscal) <= 50),
  add constraint documents_buyer_address_length check (length(buyer_address) <= 500);

-- handle_new_user() already cuts the signup name to 100 characters.
alter table public.profiles
  add constraint profiles_full_name_length check (length(full_name) <= 100);
