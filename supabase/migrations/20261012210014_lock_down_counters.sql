-- document_counters is touched by finalize_document() only, which runs as the table owner.
-- The service role keeps ALL on new tables through Supabase's default privileges and
-- bypasses RLS, so it could still rewrite a counter by hand. Take that away too.
revoke all on table public.document_counters from service_role;
