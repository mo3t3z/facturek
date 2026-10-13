-- P2d2a: the totals of a document.
--   A. private.compute_totals(): the rounding rule, case by case
--   B. parity with the hand-written vectors of src/lib/money/vectors.json
--   C. structure: one formula, in one place, callable by nobody from the API
--   D. the trigger set_document_totals, for every role
--   E. every new CHECK, by name
--   F. finalize_document(): the timbre is snapshotted on factures only
-- Every amount and rate below is an arbitrary TEST value, not a tax value.
begin;
select * from no_plan();

select tests.seed();

-- The result of compute_totals() in the shape of the "expected" object of vectors.json:
-- every amount as text, the TVA table as [rate, base, tva], and the range error when the
-- net à payer does not fit numeric(12,3). Built from the function's own output only.
create function pg_temp.as_vector(p_lines private.document_line[], p_timbre numeric)
returns jsonb
language sql
as $$
  select case
    when t.net_a_payer > 999999999.999 then jsonb_build_object('error', 'MoneyRangeError')
    else jsonb_build_object(
      'lineTotals', to_jsonb(t.line_totals::text[]),
      'tvaLines', coalesce(
        (select jsonb_agg(jsonb_build_array(r.value ->> 'rate', r.value ->> 'base', r.value ->> 'tva') order by r.n)
         from jsonb_array_elements(t.tva_breakdown) with ordinality as r (value, n)),
        '[]'::jsonb),
      'totalHT', t.total_ht::text,
      'totalTVA', t.total_tva::text,
      'totalTTC', t.total_ttc::text,
      'netAPayer', t.net_a_payer::text)
  end
  from private.compute_totals(p_lines, p_timbre) t;
$$;

-- The five stored totals of a document, as text.
create function pg_temp.stored(p_key text)
returns text
language sql
as $$
  select concat_ws(' | ', coalesce(d.total_ht::text, 'NULL'), coalesce(d.total_tva::text, 'NULL'),
                   coalesce(d.total_ttc::text, 'NULL'), coalesce(d.net_a_payer::text, 'NULL'),
                   coalesce(d.tva_breakdown::text, 'NULL'))
  from public.documents d
  where d.id = tests.id(p_key);
$$;

-- A draft facture of org_a with two lines: 1 x 100.000 at 0 % (from create_draft) and
-- 2 x 10.000 at 19 %. HT 120.000, TVA 3.800, TTC 123.800.
create function pg_temp.draft(p_key text, p_type public.document_type default 'facture')
returns void
language plpgsql
as $$
begin
  perform tests.create_draft(p_key, tests.id('org_a'), tests.id('client_a'), p_type);
  insert into public.document_items (organization_id, document_id, position, description, quantity, unit_price, tva_rate)
  values (tests.id('org_a'), tests.id(p_key), 1, 'Deuxième ligne', 2, 10.000, 19);
end;
$$;

-- Issues a draft BY HAND, as a privileged role could, and tries to impose totals.
create function pg_temp.issue_by_hand(
  p_key text, p_number integer,
  p_ht numeric, p_tva numeric, p_ttc numeric, p_net numeric, p_breakdown jsonb
)
returns void
language sql
as $$
  update public.documents
  set status = 'sent', number = p_number, year = 2021, issue_date = date '2021-01-01',
      seller_name = 's', buyer_name = 'b', retenue_enabled = false,
      total_ht = p_ht, total_tva = p_tva, total_ttc = p_ttc, net_a_payer = p_net, tva_breakdown = p_breakdown
  where id = tests.id(p_key);
$$;

-- =========================================================================================
-- A. private.compute_totals()
-- =========================================================================================
select is(
  pg_temp.as_vector(null, null),
  '{"lineTotals":[],"tvaLines":[],"totalHT":"0.000","totalTVA":"0.000","totalTTC":"0.000","netAPayer":"0.000"}'::jsonb,
  'no line (NULL): zeros with 3 decimals and an empty TVA table');
select is(
  pg_temp.as_vector('{}', 0.600),
  '{"lineTotals":[],"tvaLines":[],"totalHT":"0.000","totalTVA":"0.000","totalTTC":"0.000","netAPayer":"0.600"}'::jsonb,
  'no line (empty array) with a timbre: TTC stays 0, the net à payer is the timbre alone');
select is(
  pg_temp.as_vector('{"(0.001,0.500,0)"}', null) -> 'lineTotals', '["0.001"]'::jsonb,
  'line tie: 0.0005 is rounded half-up to 0.001');
select is(
  pg_temp.as_vector('{"(0.001,0.499,0)"}', null) -> 'lineTotals', '["0.000"]'::jsonb,
  'just under the tie: 0.000499 gives 0.000');
select is(
  pg_temp.as_vector('{"(1.5,0.001,0)","(2.5,0.001,0)"}', null) -> 'lineTotals', '["0.002", "0.003"]'::jsonb,
  'half-up, not half-even: 0.0015 -> 0.002 and 0.0025 -> 0.003');
select is(
  pg_temp.as_vector('{"(1,0.050,19)"}', null) ->> 'totalTVA', '0.010',
  'TVA tie: 19 % of 0.050 = 0.0095 gives 0.010');
select is(
  pg_temp.as_vector('{"(1,0.003,19)","(1,0.003,19)","(1,0.003,19)"}', null) -> 'tvaLines', '[["19.000", "0.009", "0.002"]]'::jsonb,
  'TVA once per rate: base 0.009 gives 0.002 (per line it would be 0.001 three times)');
select is(
  pg_temp.as_vector('{"(1,0.003,19)","(1,0.003,19.000)","(1,0.003,19.0)"}', null) -> 'tvaLines', '[["19.000", "0.009", "0.002"]]'::jsonb,
  'the same rate written with a different number of decimals is ONE rate');
select is(
  pg_temp.as_vector('{"(1,100,19)","(1,10,0)","(2,50,7)"}', null) -> 'tvaLines',
  '[["0.000", "10.000", "0.000"], ["7.000", "100.000", "7.000"], ["19.000", "100.000", "19.000"]]'::jsonb,
  'the TVA table is sorted by rate and keeps the rate 0 with its base');
select is(
  pg_temp.as_vector('{"(3,1,0)","(1,1,0)","(2,1,0)"}', null) -> 'lineTotals', '["3.000", "1.000", "2.000"]'::jsonb,
  'line totals come back in the order of the lines given');
select results_eq(
  $$ select total_ht, total_tva, total_ttc, net_a_payer from private.compute_totals('{"(2,10,19)"}', 1.000) $$,
  $$ values (20.000::numeric, 3.800::numeric, 23.800::numeric, 24.800::numeric) $$,
  'the timbre is added after TVA: it is in the net à payer only, never in the TVA base nor in total TTC');
select results_eq(
  $$ select total_ht, net_a_payer from private.compute_totals('{"(2,999999999.999,0)"}', null) $$,
  $$ values (1999999999.998::numeric, 1999999999.998::numeric) $$,
  'a total above numeric(12,3) is returned without error: the caller decides');
select is(
  (select bool_and(jsonb_typeof(e.value -> k.key) = 'string')
   from private.compute_totals('{"(1,100,19)","(1,10,0)"}', null) t,
        jsonb_array_elements(t.tva_breakdown) e (value),
        (values ('rate'), ('base'), ('tva')) k (key)),
  true, 'every value of tva_breakdown is a JSON string, never a JSON number');
select is(
  (select t.tva_breakdown from private.compute_totals('{"(8,20,19)"}', null) t),
  '[{"rate":"19.000","base":"160.000","tva":"30.400"}]'::jsonb,
  'tva_breakdown has exactly the documented shape');

-- =========================================================================================
-- B. PARITY WITH THE HAND-WRITTEN VECTORS
-- =========================================================================================
-- pgTAP cannot read a file: the 22 hand-written vectors of src/lib/money/vectors.json are
-- inlined here (lines, timbre, and their "expected" object, verbatim). The same vectors
-- are run against the TypeScript module by Vitest, so both sides answer the same file.
-- The 600 random vectors are produced by this same function (npm run money:vectors).
select is(pg_temp.as_vector(v.lines::private.document_line[], v.timbre), v.expected::jsonb, 'vector ' || v.n || ': ' || v.comment)
from (values
  (0, 'Plain case. 2 x 10.000 = 20.000; TVA 19 % of 20.000 = 3.800; TTC 23.800.'::text, '{"(2.000,10.000,19.000)"}'::text, null::numeric, '{"lineTotals":["20.000"],"tvaLines":[["19.000","20.000","3.800"]],"totalHT":"20.000","totalTVA":"3.800","totalTTC":"23.800","netAPayer":"23.800"}'::text),
  (1, 'Line tie. 0.001 x 0.500 = 0.0005, exactly half a millime: half-up gives 0.001 (truncation would give 0.000).', '{"(0.001,0.500,0.000)"}', null, '{"lineTotals":["0.001"],"tvaLines":[["0.000","0.001","0.000"]],"totalHT":"0.001","totalTVA":"0.000","totalTTC":"0.001","netAPayer":"0.001"}'),
  (2, 'Just under the tie. 0.001 x 0.499 = 0.000499, below half a millime: 0.000.', '{"(0.001,0.499,0.000)"}', null, '{"lineTotals":["0.000"],"tvaLines":[["0.000","0.000","0.000"]],"totalHT":"0.000","totalTVA":"0.000","totalTTC":"0.000","netAPayer":"0.000"}'),
  (3, 'Half-up, not half-even. 1.5 x 0.001 = 0.0015 -> 0.002 and 2.5 x 0.001 = 0.0025 -> 0.003 (banker''s rounding would give 0.002 twice). Base 0.005.', '{"(1.500,0.001,0.000)","(2.500,0.001,0.000)"}', null, '{"lineTotals":["0.002","0.003"],"tvaLines":[["0.000","0.005","0.000"]],"totalHT":"0.005","totalTVA":"0.000","totalTTC":"0.005","netAPayer":"0.005"}'),
  (4, 'Quantity with 3 decimals, tie on the line. 1.333 x 7.500 = 9.9975 -> 9.998. TVA 19 % of 9.998 = 1.89962 -> 1.900. TTC 11.898.', '{"(1.333,7.500,19.000)"}', null, '{"lineTotals":["9.998"],"tvaLines":[["19.000","9.998","1.900"]],"totalHT":"9.998","totalTVA":"1.900","totalTTC":"11.898","netAPayer":"11.898"}'),
  (5, 'TVA once per rate, not per line (option B). Three lines of 0.003 at 19 %: base 0.009, TVA = 0.00171 -> 0.002. Per line it would be 0.00057 -> 0.001 three times = 0.003.', '{"(1.000,0.003,19.000)","(1.000,0.003,19.000)","(1.000,0.003,19.000)"}', null, '{"lineTotals":["0.003","0.003","0.003"],"tvaLines":[["19.000","0.009","0.002"]],"totalHT":"0.009","totalTVA":"0.002","totalTTC":"0.011","netAPayer":"0.011"}'),
  (6, 'Several rates given out of order, with a timbre. Bases: 0 % -> 10.000; 7 % -> 100.000 (TVA 7.000); 13 % -> 1.000 (TVA 0.130); 19 % -> 100.000 + 60.000 = 160.000 (TVA 30.400). HT 271.000, TVA 37.530, TTC 271.000 + 37.530 = 308.530 (never the timbre), net à payer 308.530 + 1.000 = 309.530. The table is sorted by rate.', '{"(1.000,100.000,19.000)","(2.000,50.000,7.000)","(1.000,10.000,0.000)","(3.000,20.000,19.000)","(1.000,1.000,13.000)"}', 1.000, '{"lineTotals":["100.000","100.000","10.000","60.000","1.000"],"tvaLines":[["0.000","10.000","0.000"],["7.000","100.000","7.000"],["13.000","1.000","0.130"],["19.000","160.000","30.400"]],"totalHT":"271.000","totalTVA":"37.530","totalTTC":"308.530","netAPayer":"309.530"}'),
  (7, 'TVA tie. 19 % of 0.050 = 0.0095, exactly half a millime: 0.010. TTC 0.060.', '{"(1.000,0.050,19.000)"}', null, '{"lineTotals":["0.050"],"tvaLines":[["19.000","0.050","0.010"]],"totalHT":"0.050","totalTVA":"0.010","totalTTC":"0.060","netAPayer":"0.060"}'),
  (8, 'A rate with 3 decimals, TVA tie. 0.050 % of 1.000 = 0.0005 -> 0.001. TTC 1.001.', '{"(1.000,1.000,0.050)"}', null, '{"lineTotals":["1.000"],"tvaLines":[["0.050","1.000","0.001"]],"totalHT":"1.000","totalTVA":"0.001","totalTTC":"1.001","netAPayer":"1.001"}'),
  (9, 'Zero price. Everything is 0, TTC included; only the net à payer carries the timbre: 1.000. The 19 % rate still appears in the table with a base of 0.', '{"(5.000,0.000,19.000)"}', 1.000, '{"lineTotals":["0.000"],"tvaLines":[["19.000","0.000","0.000"]],"totalHT":"0.000","totalTVA":"0.000","totalTTC":"0.000","netAPayer":"1.000"}'),
  (10, 'No lines, no timbre: every total is 0 and the TVA table is empty.', '{}', null, '{"lineTotals":[],"tvaLines":[],"totalHT":"0.000","totalTVA":"0.000","totalTTC":"0.000","netAPayer":"0.000"}'),
  (11, 'No lines, with a timbre: TTC is 0, the net à payer is the timbre alone.', '{}', 0.600, '{"lineTotals":[],"tvaLines":[],"totalHT":"0.000","totalTVA":"0.000","totalTTC":"0.000","netAPayer":"0.600"}'),
  (12, 'The largest amount of numeric(12,3), exactly: 1 x 999999999.999 at 0 %. Still allowed.', '{"(1.000,999999999.999,0.000)"}', null, '{"lineTotals":["999999999.999"],"tvaLines":[["0.000","999999999.999","0.000"]],"totalHT":"999999999.999","totalTVA":"0.000","totalTTC":"999999999.999","netAPayer":"999999999.999"}'),
  (13, 'One millime over the maximum, through the timbre: 999999999.999 + 0.001 = 1000000000.000.', '{"(1.000,999999999.999,0.000)"}', 0.001, '{"error":"MoneyRangeError"}'),
  (14, 'Over the maximum on a single line: 2 x 999999999.999 = 1999999999.998.', '{"(2.000,999999999.999,0.000)"}', null, '{"error":"MoneyRangeError"}'),
  (15, 'Each line fits, their sum does not: 500000000.000 + 500000000.000 = 1000000000.000.', '{"(1.000,500000000.000,0.000)","(1.000,500000000.000,0.000)"}', null, '{"error":"MoneyRangeError"}'),
  (16, 'HT fits, HT + TVA does not: 900000000.000 + 19 % (171000000.000) = 1071000000.000.', '{"(1.000,900000000.000,19.000)"}', null, '{"error":"MoneyRangeError"}'),
  (17, 'base x rate above 2^53. Base 829999968999 millimes x rate 19001 = 15770829410949999 (2^53 is about 9.007e15); divided by 100000 = 157708294109.49999 -> 157708294.109. A float cannot hold that odd product: it becomes ...950000, a false tie, and gives 157708294.110. TTC 829999968.999 + 157708294.109 = 987708263.108.', '{"(1.000,829999968.999,19.001)"}', null, '{"lineTotals":["829999968.999"],"tvaLines":[["19.001","829999968.999","157708294.109"]],"totalHT":"829999968.999","totalTVA":"157708294.109","totalTTC":"987708263.108","netAPayer":"987708263.108"}'),
  (18, 'quantity x price far above 2^53 (about 1e24 before scaling): the result is about 1e18 TND, over the maximum.', '{"(999999999.999,999999999.999,0.000)"}', null, '{"error":"MoneyRangeError"}'),
  (19, 'Large quantity and price with 3 decimals. 999999.999 x 999.999 = 999999999 - 999.999999 = 999998999.000001 -> 999998999.000.', '{"(999999.999,999.999,0.000)"}', null, '{"lineTotals":["999998999.000"],"tvaLines":[["0.000","999998999.000","0.000"]],"totalHT":"999998999.000","totalTVA":"0.000","totalTTC":"999998999.000","netAPayer":"999998999.000"}'),
  (20, 'The highest rate, 100 %: TVA equals the base. 12.345 + 12.345 = 24.690.', '{"(1.000,12.345,100.000)"}', null, '{"lineTotals":["12.345"],"tvaLines":[["100.000","12.345","12.345"]],"totalHT":"12.345","totalTVA":"12.345","totalTTC":"24.690","netAPayer":"24.690"}'),
  (21, '3 decimals on both sides. 0.333 x 0.333 = 0.110889 -> 0.111. TVA 7 % = 0.00777 -> 0.008. TTC 0.119.', '{"(0.333,0.333,7.000)"}', null, '{"lineTotals":["0.111"],"tvaLines":[["7.000","0.111","0.008"]],"totalHT":"0.111","totalTVA":"0.008","totalTTC":"0.119","netAPayer":"0.119"}')
) as v (n, comment, lines, timbre, expected)
order by v.n;

-- =========================================================================================
-- C. STRUCTURE
-- =========================================================================================
select is(
  (select p.prosrc ~ 'round\s*\(' from pg_proc p where p.oid = 'public.finalize_document(uuid)'::regprocedure),
  false, 'finalize_document contains no rounding of its own');
select is(
  (select p.prosrc ~ 'round\s*\(' from pg_proc p where p.oid = 'private.set_document_totals()'::regprocedure),
  false, 'the totals trigger contains no rounding of its own');
select is(
  (select p.prosrc ~ 'private\.compute_totals\(' from pg_proc p where p.oid = 'private.set_document_totals()'::regprocedure),
  true, 'the totals trigger calls private.compute_totals');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosrc ~ 'round\s*\('),
  1, 'exactly one function of the application rounds an amount');
select is(
  (select concat_ws(' ', p.prosecdef, p.provolatile, p.proconfig, l.lanname)
   from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'private.compute_totals(private.document_line[], numeric)'::regprocedure),
  'f i {"search_path=\"\""} sql',
  'compute_totals is immutable SQL, not SECURITY DEFINER, with an empty search_path');
select is(
  has_function_privilege('anon', 'private.compute_totals(private.document_line[], numeric)', 'EXECUTE')
  or has_function_privilege('authenticated', 'private.compute_totals(private.document_line[], numeric)', 'EXECUTE')
  or has_function_privilege('service_role', 'private.compute_totals(private.document_line[], numeric)', 'EXECUTE'),
  false, 'compute_totals is not executable by anon, authenticated or service_role');
select is(
  (select concat_ws(' ', p.prosecdef, p.proconfig) from pg_proc p where p.oid = 'private.set_document_totals()'::regprocedure),
  't {"search_path=\"\""}',
  'the totals trigger function is SECURITY DEFINER with an empty search_path');
select is(
  has_function_privilege('anon', 'private.set_document_totals()', 'EXECUTE')
  or has_function_privilege('authenticated', 'private.set_document_totals()', 'EXECUTE')
  or has_function_privilege('service_role', 'private.set_document_totals()', 'EXECUTE'),
  false, 'the totals trigger function is not executable by anon, authenticated or service_role');
select is(
  has_type_privilege('anon', 'private.document_line', 'USAGE')
  or has_type_privilege('authenticated', 'private.document_line', 'USAGE')
  or has_type_privilege('service_role', 'private.document_line', 'USAGE'),
  false, 'the type private.document_line is not usable by anon, authenticated or service_role');

-- BEFORE row triggers fire in the order of their names; CHECK constraints come after.
select is(
  (select array_agg(t.tgname::text order by t.tgname)
   from pg_trigger t
   where t.tgrelid = 'public.documents'::regclass and not t.tgisinternal
     and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16),
  array['guard_document_conversion', 'guard_documents', 'set_document_totals', 'set_updated_at'],
  'BEFORE UPDATE triggers of documents, in firing order: the guards, then the totals');
select is(
  (select array_agg(t.tgname::text order by t.tgname)
   from pg_trigger t
   where t.tgrelid = 'public.documents'::regclass and not t.tgisinternal
     and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4),
  array['guard_document_conversion', 'set_document_totals'],
  'BEFORE INSERT triggers of documents, in firing order');

-- finalize_document keeps its signature and its grants (the body was replaced in place).
select is(
  (select array_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_document'),
  array['finalize_document(uuid)'], 'there is exactly one finalize_document, with the signature (uuid)');
select is(
  has_function_privilege('authenticated', 'public.finalize_document(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_document(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.finalize_document(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.finalize_document(uuid)', 'EXECUTE'),
  true, 'finalize_document is still executable by authenticated only');

-- The API role reads the totals and can write none of them.
select is(
  (select bool_and(has_column_privilege('authenticated', 'public.documents', c.name, 'SELECT')
                   and not has_column_privilege('authenticated', 'public.documents', c.name, 'INSERT')
                   and not has_column_privilege('authenticated', 'public.documents', c.name, 'UPDATE')
                   and not has_column_privilege('anon', 'public.documents', c.name, 'SELECT'))
   from (values ('total_ht'), ('total_tva'), ('total_ttc'), ('net_a_payer'), ('tva_breakdown')) c (name)),
  true, 'authenticated can SELECT the five totals columns and cannot INSERT or UPDATE them; anon cannot read them');

-- =========================================================================================
-- D. THE TRIGGER set_document_totals (as a privileged role: only triggers and CHECKs apply)
-- =========================================================================================
select pg_temp.draft('d_draft');
select pg_temp.draft('d_marked');
select pg_temp.draft('d_wrong');
select pg_temp.draft('d_timbre');
select pg_temp.draft('d_paid');
select pg_temp.draft('d_devis', 'devis');
select pg_temp.draft('d_api');

-- A draft never keeps totals.
select lives_ok(
  $$ update public.documents set total_ht = 1, total_tva = 1, total_ttc = 2, net_a_payer = 2, tva_breakdown = '[]'
     where id = tests.id('d_draft') $$,
  'a privileged role may try to write totals on a draft: no error');
select is(pg_temp.stored('d_draft'), 'NULL | NULL | NULL | NULL | NULL', 'but the draft stores none of them');
select lives_ok(
  $$ insert into public.documents (organization_id, type, total_ht, total_tva, total_ttc, net_a_payer, tva_breakdown)
     values (tests.id('org_a'), 'facture', 1, 1, 2, 2, '[]') returning tests.remember('d_inserted_draft', id) $$,
  'a privileged INSERT of a draft with totals: no error');
select is(pg_temp.stored('d_inserted_draft'), 'NULL | NULL | NULL | NULL | NULL', 'and the inserted draft stores none either');

-- Issued by hand WITHOUT any total: the trigger writes them, and it runs BEFORE the CHECKs
-- are evaluated (otherwise documents_issued_is_complete would refuse this update).
select lives_ok(
  $$ select tests.mark_sent(tests.id('d_marked'), 501, 2021) $$,
  'a document issued by hand without totals passes documents_issued_is_complete: the trigger ran first');
select is(
  pg_temp.stored('d_marked'),
  '120.000 | 3.800 | 123.800 | 123.800 | [{"tva": "0.000", "base": "100.000", "rate": "0.000"}, {"tva": "3.800", "base": "20.000", "rate": "19.000"}]',
  'its totals are those of its lines');

-- Issued by hand WITH wrong totals: they are overwritten.
select lives_ok(
  $$ select pg_temp.issue_by_hand('d_wrong', 502, 1, 1, 2, 2, '[]') $$,
  'a privileged role may try to impose totals at issue: no error');
select is(pg_temp.stored('d_wrong'), pg_temp.stored('d_marked'), 'the imposed totals were replaced by those of the lines');

-- A timbre written in the same statement is part of the net à payer, not of the TTC.
select lives_ok(
  $$ update public.documents
     set status = 'sent', number = 503, year = 2021, issue_date = date '2021-01-01',
         seller_name = 's', buyer_name = 'b', retenue_enabled = false, timbre_fiscal = 0.600
     where id = tests.id('d_timbre') $$,
  'a facture issued by hand with a timbre');
select results_eq(
  $$ select total_ttc, timbre_fiscal, net_a_payer from public.documents where id = tests.id('d_timbre') $$,
  $$ values (123.800::numeric, 0.600::numeric, 124.400::numeric) $$,
  'total TTC ignores the timbre; net à payer = total TTC + timbre');

-- guard_documents is intact: it runs first, and the totals are frozen like any column.
select throws_ok(
  $$ update public.documents set total_ht = 1 where id = tests.id('d_marked') $$,
  'DF011', 'a sent document is frozen; cannot change: total_ht',
  'a total of an issued document cannot be changed (DF011)');
select throws_ok(
  $$ update public.documents set net_a_payer = 1, tva_breakdown = '[]' where id = tests.id('d_marked') $$,
  'DF011', 'a sent document is frozen; cannot change: net_a_payer, tva_breakdown',
  'nor its net à payer or its TVA table (DF011)');
select throws_ok(
  $$ update public.documents set status = 'draft', number = null, year = null where id = tests.id('d_marked') $$,
  'DF012', null, 'an issued document cannot go back to draft (DF012): the totals trigger is not even reached');
select throws_ok(
  $$ delete from public.documents where id = tests.id('d_marked') $$,
  'DF010', null, 'an issued document still cannot be deleted (DF010)');
select is(pg_temp.stored('d_marked'), pg_temp.stored('d_wrong'), 'after the refused attempts the totals are unchanged');
select tests.mark_sent(tests.id('d_paid'), 504, 2021);
select lives_ok(
  $$ update public.documents set status = 'paid' where id = tests.id('d_paid') $$,
  'sent -> paid is still allowed');
select is(pg_temp.stored('d_paid'), pg_temp.stored('d_marked'), 'and the totals survive the status change untouched');

-- A document inserted directly as non-draft has no line yet: zeros.
select lives_ok(
  $$ insert into public.documents (organization_id, type, status, number, year, client_id, issue_date,
                                   seller_name, buyer_name, retenue_enabled)
     values (tests.id('org_a'), 'facture', 'cancelled', 590, 2021, tests.id('client_a'), date '2021-01-01', 's', 'b', false)
     returning tests.remember('d_inserted_cancelled', id) $$,
  'a privileged INSERT directly as non-draft is still possible');
select is(pg_temp.stored('d_inserted_cancelled'), '0.000 | 0.000 | 0.000 | 0.000 | []', 'it gets zeros and an empty TVA table');

-- The API role cannot write a total, even on its own draft.
select tests.authenticate_as('alice@test.local');
select throws_ok($$ update public.documents set total_ht = 1 where id = tests.id('d_api') $$, '42501', null, 'API: total_ht cannot be written');
select throws_ok($$ update public.documents set total_tva = 1 where id = tests.id('d_api') $$, '42501', null, 'API: total_tva cannot be written');
select throws_ok($$ update public.documents set total_ttc = 1 where id = tests.id('d_api') $$, '42501', null, 'API: total_ttc cannot be written');
select throws_ok($$ update public.documents set net_a_payer = 1 where id = tests.id('d_api') $$, '42501', null, 'API: net_a_payer cannot be written');
select throws_ok($$ update public.documents set tva_breakdown = '[]' where id = tests.id('d_api') $$, '42501', null, 'API: tva_breakdown cannot be written');
select throws_ok(
  $$ insert into public.documents (organization_id, type, client_id, net_a_payer)
     values (tests.id('org_a'), 'facture', tests.id('client_a'), 1) $$,
  '42501', null, 'API: a total cannot be set at INSERT');
select results_eq(
  $$ select total_ht, net_a_payer from public.documents where id = tests.id('d_marked') $$,
  $$ values (120.000::numeric, 123.800::numeric) $$,
  'API: a member reads the totals of an issued document of their organization');
select tests.clear_auth();

-- =========================================================================================
-- E. EVERY NEW CHECK, BY NAME
-- =========================================================================================
-- These three need nothing special: the trigger does not write timbre_fiscal.
select throws_ok(
  $$ update public.documents set timbre_fiscal = 1 where id = tests.id('d_devis') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_devis_has_no_timbre"',
  'CHECK: a devis cannot carry a timbre, even as a draft, even for a privileged role');
select throws_ok(
  $$ update public.documents set status = 'sent', number = 510, year = 2021, issue_date = date '2021-01-01',
       seller_name = 's', buyer_name = 'b', retenue_enabled = false, timbre_fiscal = 1 where id = tests.id('d_devis') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_devis_has_no_timbre"',
  'CHECK: nor can a devis be issued by hand with a timbre');
select throws_ok(
  $$ update public.documents set timbre_fiscal = -0.001 where id = tests.id('d_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_timbre_fiscal_not_negative"',
  'CHECK: the timbre snapshot cannot be negative');

select throws_ok(
  $$ update public.tax_settings set timbre_enabled = true, timbre_fiscal = null where organization_id = tests.id('org_a') $$,
  '23514', 'new row for relation "tax_settings" violates check constraint "tax_settings_timbre_enabled_has_amount"',
  'CHECK: the timbre cannot be enabled without an amount');
select lives_ok(
  $$ update public.tax_settings set timbre_enabled = true, timbre_fiscal = 0 where organization_id = tests.id('org_b') $$,
  'an amount of zero is an amount: accepted');
select lives_ok(
  $$ update public.tax_settings set timbre_enabled = false, timbre_fiscal = null where organization_id = tests.id('org_b') $$,
  'disabled without an amount: accepted');

select lives_ok(
  $$ update public.document_items set description = repeat('é', 500) where id = tests.id('d_draft:item') $$,
  'a description of exactly 500 characters is accepted (characters, not bytes)');
select throws_ok(
  $$ update public.document_items set description = repeat('é', 501) where id = tests.id('d_draft:item') $$,
  '23514', 'new row for relation "document_items" violates check constraint "document_items_description_length"',
  'CHECK: a description of 501 characters is refused');
select throws_ok(
  $$ insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
     values (tests.id('org_a'), tests.id('d_draft'), repeat('x', 501), 1, 1, 0) $$,
  '23514', 'new row for relation "document_items" violates check constraint "document_items_description_length"',
  'CHECK: and it is refused at INSERT too');

-- The CHECKs on the totals can never be reached while the trigger is there: it overwrites
-- whatever is sent. To prove each CHECK exists and works on its own, the trigger is
-- disabled for the rest of this section (this transaction is rolled back).
alter table public.documents disable trigger set_document_totals;
select pg_temp.draft('e_draft');
select pg_temp.draft('e_issue');

select throws_ok(
  $$ update public.documents set total_ht = 0 where id = tests.id('e_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_draft_has_no_totals"',
  'CHECK: a draft cannot carry total_ht');
select throws_ok(
  $$ update public.documents set tva_breakdown = '[]' where id = tests.id('e_draft') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_draft_has_no_totals"',
  'CHECK: a draft cannot carry tva_breakdown');
select throws_ok(
  $$ select tests.mark_sent(tests.id('e_issue'), 520, 2021) $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'CHECK: without the trigger, a document issued without totals is refused');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, null, 3.8, 123.8, 123.8, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'CHECK: issued requires total_ht');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, null, 123.8, 123.8, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'CHECK: issued requires total_tva');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, null, 123.8, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'CHECK: issued requires total_ttc');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, 123.8, null, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'CHECK: issued requires net_a_payer');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, 123.8, 123.8, null) $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_issued_is_complete"',
  'CHECK: issued requires tva_breakdown');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, 123.801, 123.801, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_total_ttc_is_ht_plus_tva"',
  'CHECK: total_ttc must be total_ht + total_tva');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, 123.8, 123.801, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_net_a_payer_is_ttc_plus_timbre"',
  'CHECK: net_a_payer must be total_ttc + timbre (no timbre here)');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, -1, 1, 0, 0, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_totals_not_negative"',
  'CHECK: total_ht cannot be negative');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 1, -1, 0, 0, '[]') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_totals_not_negative"',
  'CHECK: total_tva cannot be negative');
select throws_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, 123.8, 123.8, '{}') $$,
  '23514', 'new row for relation "documents" violates check constraint "documents_tva_breakdown_is_array"',
  'CHECK: tva_breakdown must be a JSON array');
select lives_ok(
  $$ select pg_temp.issue_by_hand('e_issue', 520, 120, 3.8, 123.8, 123.8, '[]') $$,
  'with five consistent totals the same update is accepted');
alter table public.documents enable trigger set_document_totals;

-- =========================================================================================
-- F. finalize_document(): THE TIMBRE IS FOR FACTURES ONLY
-- =========================================================================================
-- org_a applies the timbre and has an amount (9.999, an arbitrary test value from seed()).
update public.tax_settings set timbre_enabled = true where organization_id = tests.id('org_a');
select pg_temp.draft('f_devis', 'devis');
select pg_temp.draft('f_facture');

select lives_ok(
  $$ select tests.finalize_as('alice@test.local', tests.id('f_devis')) $$,
  'a devis of an organization that applies the timbre is finalized');
select results_eq(
  $$ select status::text, timbre_fiscal, total_ht, total_tva, total_ttc, net_a_payer
     from public.documents where id = tests.id('f_devis') $$,
  $$ values ('sent', null::numeric, 120.000::numeric, 3.800::numeric, 123.800::numeric, 123.800::numeric) $$,
  'the devis carries NO timbre, and its net à payer is its total TTC');

select lives_ok(
  $$ select tests.finalize_as('alice@test.local', tests.id('f_facture')) $$,
  'a facture of the same organization is finalized');
select results_eq(
  $$ select status::text, timbre_fiscal, total_ht, total_tva, total_ttc, net_a_payer
     from public.documents where id = tests.id('f_facture') $$,
  $$ values ('sent', 9.999::numeric, 120.000::numeric, 3.800::numeric, 123.800::numeric, 133.799::numeric) $$,
  'the facture carries the timbre: total TTC without it, net à payer with it');
select is(
  (select d.tva_breakdown from public.documents d where d.id = tests.id('f_facture')),
  '[{"rate":"0.000","base":"100.000","tva":"0.000"},{"rate":"19.000","base":"20.000","tva":"3.800"}]'::jsonb,
  'the stored TVA table of the facture, amounts as text');
select is(
  (select row(d.total_ht, d.total_tva, d.total_ttc, d.net_a_payer, d.tva_breakdown)::text
   from public.documents d where d.id = tests.id('f_facture')),
  (select row(t.total_ht::numeric(12,3), t.total_tva::numeric(12,3), t.total_ttc::numeric(12,3), t.net_a_payer::numeric(12,3), t.tva_breakdown)::text
   from private.compute_totals(
     (select array_agg(row(i.quantity, i.unit_price, i.tva_rate)::private.document_line)
      from public.document_items i where i.document_id = tests.id('f_facture')),
     9.999) t),
  'what finalize stored is what compute_totals says about the stored lines');

-- An organization without a tax_settings row: issued, nothing enabled, no timbre.
delete from public.tax_settings where organization_id = tests.id('org_b');
select tests.create_draft('f_no_settings', tests.id('org_b'), tests.id('client_b'));
select lives_ok(
  $$ select tests.finalize_as('bob@test.local', tests.id('f_no_settings')) $$,
  'a facture of an organization without a tax_settings row is finalized');
select results_eq(
  $$ select timbre_fiscal, total_ttc, net_a_payer from public.documents where id = tests.id('f_no_settings') $$,
  $$ values (null::numeric, 100.000::numeric, 100.000::numeric) $$,
  'it has no timbre and its net à payer is its total TTC');

select * from finish();
rollback;
