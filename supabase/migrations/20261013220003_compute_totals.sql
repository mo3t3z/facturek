-- P2d2a, 3/6. THE totals of a document, in one place.
--
-- This function is the only SQL that knows the rounding rule. It is called by
--   * private.set_document_totals()  (migration 5/6): the totals stored on a document;
--   * scripts/generate-money-vectors.mjs and scripts/test-e2e-items.mjs: the oracle that
--     the TypeScript module src/lib/money is tested against.
-- So the oracle of the tests IS the production code, not a copy of it.
--
-- ROUNDING RULE (option B of docs/phase2-plan.md), half-up to the millime:
--   1. line total HT = round(quantity * unit_price, 3), per line;
--   2. per TVA rate: base = sum of the rounded line totals of that rate;
--      TVA = round(base * rate / 100, 3), ONCE per rate, not per line;
--   3. total_ht = sum of the bases, total_tva = sum of the TVA of each rate,
--      total_ttc = total_ht + total_tva                      (never the timbre),
--      net_a_payer = total_ttc + coalesce(p_timbre, 0)       (timbre added after TVA and
--                                                             not subject to it).
-- Nothing is negative here, so round(numeric, 3) is "half-up": 0.0005 -> 0.001.
-- TODO(accountant): the whole rule (per-rate TVA, half-up, timbre after TVA and outside
-- its base, total TTC without the timbre, net à payer with it) must be verified before
-- real use. No rate and no amount is written in this file: they are arguments.

-- One line, as the function needs it. Plain numeric on purpose: the values come from
-- columns that already carry their own precision and CHECKs.
create type private.document_line as (
  quantity numeric,
  unit_price numeric,
  tva_rate numeric
);
revoke all on type private.document_line from public, anon, authenticated, service_role;

-- The lines are an ARGUMENT, not a document id: the function reads no table. That is what
-- lets the vector script call it on a list of values without writing a single row.
--
-- Results are plain numeric, not numeric(12,3): the function never fails on a large
-- total. The caller decides what "too large" means (as nothing is negative, any value
-- above the maximum implies net_a_payer above the maximum).
--
--   line_totals    the rounded total of each line, in the order of p_lines
--   tva_breakdown  one object per rate present in the lines (rate 0 included), sorted by
--                  rate; every value is TEXT with 3 decimals, never a JSON number (a JSON
--                  number would be a float in JavaScript):
--                  [{"rate":"19.000","base":"160.000","tva":"30.400"}]
-- No line (NULL or empty array): zeros, '{}' and '[]'.
--
-- Not SECURITY DEFINER: it touches no table, so it needs nobody's rights.
create function private.compute_totals(p_lines private.document_line[], p_timbre numeric)
returns table (
  line_totals numeric[],
  tva_breakdown jsonb,
  total_ht numeric,
  total_tva numeric,
  total_ttc numeric,
  net_a_payer numeric
)
language sql
immutable
set search_path = ''
as $$
  with line_total as (
    select l.n, l.tva_rate as rate, round(l.quantity * l.unit_price, 3) as total
    from unnest(p_lines) with ordinality as l (quantity, unit_price, tva_rate, n)
  ),
  rate_total as (
    select lt.rate, sum(lt.total) as base, round(sum(lt.total) * lt.rate / 100, 3) as tva
    from line_total lt
    group by lt.rate
  ),
  total as (
    select coalesce(sum(rt.base), 0.000) as ht, coalesce(sum(rt.tva), 0.000) as tva
    from rate_total rt
  )
  select
    coalesce((select array_agg(lt.total order by lt.n) from line_total lt), '{}'::numeric[]),
    coalesce(
      (select jsonb_agg(
                jsonb_build_object('rate', round(rt.rate, 3)::text, 'base', rt.base::text, 'tva', rt.tva::text)
                order by rt.rate)
       from rate_total rt),
      '[]'::jsonb),
    t.ht,
    t.tva,
    t.ht + t.tva,
    t.ht + t.tva + coalesce(p_timbre, 0)
  from total t;
$$;

-- Functions are executable by PUBLIC by default, and Supabase's default privileges also
-- grant EXECUTE to anon, authenticated and service_role. Nobody needs it from the API:
-- its callers run as the owner (the trigger function) or as postgres (the scripts).
revoke all on function private.compute_totals(private.document_line[], numeric)
  from public, anon, authenticated, service_role;
