-- P2d2a, 2/6. The description of a line is limited to 500 characters, like the screen
-- (DESCRIPTION_MAX_LENGTH in src/features/documents/itemSchema.ts). Until now only the
-- screen knew the limit; a direct API call could store any length.
-- length() counts characters, JavaScript .length counts UTF-16 units (an emoji counts 2
-- there), so the screen is never more permissive than the database.
-- Verified before writing this migration: 0 row of the local database violates it.
-- The other free-text columns (notes, client and organization fields) get their limits
-- in a separate checkpoint.
alter table public.document_items
  add constraint document_items_description_length
  check (length(description) <= 500);
