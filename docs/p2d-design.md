# P2d design: stored totals, finalize v2, timbre rules (P2d1, design only)

Written 2026-10-13 on `checkpoint/p2d1-design` from `main` (`d664661`). Nothing here is
built: no migration, no SQL file, no application code. Every tax rule below is
**TODO(accountant)** until the accountant confirms it.

Sources: the 15 migrations in `supabase/migrations`, `supabase/tests`, `scripts/`,
`src/`, and read-only catalog/data queries on the local database (PostgreSQL 17.11,
container `supabase_db_projetavecclaude`, inside `begin transaction read only`).

---

## Part 1. Facts

### 1. `public.documents`: totals, timbre, snapshots

There is **no totals column today**. The table has 24 columns; the ones that matter here:

| Column | Type | Constraint | Who writes it |
|---|---|---|---|
| `timbre_fiscal` | `numeric(12,3)` null | none (not even `>= 0`) | `finalize_document()` only |
| `retenue_enabled` | `boolean` null | required non-null once issued | `finalize_document()` only |
| `retenue_rate` | `numeric(6,3)` null | none | `finalize_document()` only |
| `retenue_threshold` | `numeric(12,3)` null | none | `finalize_document()` only |
| `seller_name`, `seller_matricule_fiscal`, `seller_address` | `text` null | `seller_name` required once issued | `finalize_document()` only |
| `buyer_name`, `buyer_matricule_fiscal`, `buyer_address` | `text` null | `buyer_name` required once issued | `finalize_document()` only |
| `status`, `number`, `year` | enum, `integer`, `integer` | see CHECKs | `finalize_document()` only |

"Only" means: for the API role. `authenticated` has INSERT on `organization_id, type,
client_id, issue_date, due_date, notes, converted_from`, UPDATE on `client_id, issue_date,
due_date, notes, converted_from`, and SELECT on the whole table (so a new column is
readable without a new grant, and not writable without one). A privileged role (service
role, SQL editor) can write every column; only triggers and CHECKs bind it.

`documents_issued_is_complete`, in full, as stored in the catalog:

```sql
CHECK (((status = 'draft'::document_status) OR ((client_id IS NOT NULL) AND (issue_date IS NOT NULL)
  AND (number IS NOT NULL) AND (year IS NOT NULL) AND (seller_name IS NOT NULL)
  AND (buyer_name IS NOT NULL) AND (retenue_enabled IS NOT NULL))))
```

Other CHECKs on the table: `documents_numbered_unless_draft`, `documents_draft_has_no_number`,
`documents_number_year_together`, `documents_due_after_issue`, `number > 0`, and
`UNIQUE (organization_id, type, year, number)`.

### 2. `public.finalize_document(p_document_id uuid) returns public.documents`

`plpgsql`, `SECURITY DEFINER`, `search_path = ''`, EXECUTE for `authenticated` only
(ACL in the catalog: `postgres`, `authenticated`). In order:

1. `auth.uid()` null -> **DF000**.
2. `SELECT ... FOR UPDATE` on the document with `private.is_org_member()` in the WHERE
   -> **DF001** when no row (unknown id and foreign organization look the same).
3. Not a draft -> **DF002**. No client -> **DF003**. No items -> **DF004**.
4. `v_issue_date := coalesce(issue_date, today in Africa/Tunis)`; in the future -> **DF005**;
   due date before it -> **DF008**.
5. Reads the organization and the client (`STRICT`), and `tax_settings` **without** STRICT.
6. Facture, `timbre_enabled` true, `timbre_fiscal` null -> **DF007**.
7. Takes the number: `INSERT ... ON CONFLICT DO UPDATE` on `document_counters`.
8. Issue date earlier than the latest numbered document of the series -> **DF006**
   (after the counter is locked, on purpose).
9. One UPDATE: `status = 'sent'`, `number`, `year`, `issue_date`, the six identity
   snapshots, and the tax snapshots.

**Totals: it computes none.** It never reads a quantity, a price or a rate; it only checks
that at least one item exists. There is no zero-total check and no expected-total check.

**Timbre on a devis: confirmed, it is snapshotted.** The expression is
`timbre_fiscal = case when coalesce(v_tax.timbre_enabled, false) then v_tax.timbre_fiscal end`
with no test on `v_doc.type`. Only the DF007 refusal looks at the type. A devis of an
organization with the timbre enabled and an amount gets that amount in `timbre_fiscal`.
No existing pgTAP test asserts this either way (the only devis in the timbre section of
`005` is finalized while the amount is NULL).

### 3. Guards and counters

**`private.guard_documents()`**: BEFORE UPDATE OR DELETE on `documents`, SECURITY DEFINER.
- Transition map (else **DF012**): `draft -> sent` (any type); `sent -> paid` (facture);
  `sent -> cancelled` (devis). Checked first, for every role.
- A draft is free (update, delete).
- Non-draft: DELETE -> **DF010**. Any change other than `status` and `updated_at` ->
  **DF011**. The comparison is generic (`to_jsonb(new) - 'status' - 'updated_at'`), so
  **every column P2d adds is frozen automatically** once the document is issued.
- It does **not** fire on INSERT. A privileged INSERT directly as `cancelled` or `sent` is
  only stopped by the CHECKs. Two fixtures rely on that (`004` line 40, `006` line 58: a
  cancelled facture, a state no transition reaches).

**`private.guard_document_items()`**: BEFORE INSERT OR UPDATE OR DELETE on `document_items`.
Moving an item -> **DF015**. `reject_non_member()` on INSERT. Locks the parent `FOR SHARE`,
parent not a draft -> **DF014**. A DELETE whose parent row is already gone (cascade of a
deleted draft) passes.

**`document_counters`**: primary key `(organization_id, type, year)`, one `last_number > 0`.
RLS on, no policy, no privilege for `anon`, `authenticated` or `service_role`. Local table
is empty (0 rows).

Trigger firing order on `documents` (alphabetical): `guard_document_conversion`,
`guard_documents`, `set_updated_at`.

### 4. DF codes

In use: DF000 to DF008 (finalize; DF000 also `ensure_my_account`), DF010 to DF012
(`guard_documents`), DF013 (conversion), DF014, DF015 (items), DF016, DF017 (payments),
DF020 (memberships), DF040 (`prevent_organization_change`).

Free: **DF009**, DF018, DF019, DF021 and everything from DF022 (except DF040).
Reserved for later, as you listed: DF018 overpayment, DF019 paid coverage, DF021 cancel
devis with a converted facture. **Next free numbers after the reservations: DF009, then
DF022, DF023, DF024.**

### 5. The Postgres side of the vectors

`scripts/generate-money-vectors.mjs` sends one read-only `SELECT` over two `VALUES` lists.
The expression:

```sql
line_total as (select v, n, rate, round(quantity * unit_price, 3) as total from line),
rate_total as (select v, rate, sum(total) as base, round(sum(total) * rate / 100, 3) as tva
               from line_total group by v, rate),
total as (select d.v, d.timbre,
                 coalesce((select sum(r.base) from rate_total r where r.v = d.v), 0.000) as ht,
                 coalesce((select sum(r.tva)  from rate_total r where r.v = d.v), 0.000) as tva
          from document d)
-- 'over'     : (ht + tva + coalesce(timbre, 0)) > 999999999.999
-- 'totalTTC' : round(ht + tva + coalesce(timbre, 0), 3)
```

**It is a copy of the logic, written inside the script. It calls nothing that production
uses**, and it could not: production has no totals code at all. `scripts/test-e2e-items.mjs`
(lines 246 to 258) holds a **second copy** of the same expressions. So today the same rule
is written three times (money.ts, two scripts) and zero times in a migration.

### 6. `tax_settings` and signup

- `private.provision_account()` inserts an **empty** row (`on conflict do nothing`): every
  rate and amount NULL, `timbre_enabled` and `retenue_enabled` false.
- **Yes, an organization can lack a row**: nothing forces one to exist (it is a separate
  table, not a column), `handle_new_user()` swallows every error, and a privileged role can
  create an organization or delete the row. Through the normal paths (signup trigger,
  `ensure_my_account()`) the row is always created in the same transaction as the
  organization. Locally: 3 organizations, 3 rows, 0 organization without one.
- **What finalize does then**: the SELECT has no STRICT, `v_tax` stays NULL, and every use
  is wrapped in `coalesce(..., false)`. Result: no DF007, `timbre_fiscal` NULL,
  `retenue_enabled` false, rate and threshold NULL. The document is issued as "nothing
  enabled". `a92b71b` made the preview behave the same way.

### Local data, as of this report (read-only)

| Table | Rows | Note |
|---|---|---|
| `organizations` / `tax_settings` | 3 / 3 | one has `timbre_enabled = true`, `timbre_fiscal = 1.000` |
| `documents` | 1 | a draft facture; **0 non-draft document** |
| `document_items` | 1 | longest description: 15 characters |
| `payments`, `document_counters` | 0, 0 | |

---

## Part 2. Proposals

### A. Where totals live

**Proposal: your preference, plus one small trigger.** Totals exist only on a non-draft
document, are computed at the moment it leaves `draft`, and are frozen by the existing
`guard_documents`. A draft stores no total; the preview stays in the browser.

**Is a trigger needed? Yes, one, and only for the moment of issue.** Reason: the project
rule "a rule that protects issued documents must be a trigger or a constraint", and the
fact that documents are issued by hand today (`tests.mark_sent()`, the two cancelled-facture
INSERTs, the manual `draft -> sent` tests of `006`). A CHECK can require that totals are
present and add up, but it cannot read `document_items`, so it cannot know that they are
the *right* totals. Without a trigger, a privileged `UPDATE ... SET status = 'sent',
total_ht = 1` would store a wrong total, frozen forever.

`private.set_document_totals()`, BEFORE INSERT OR UPDATE on `documents`:
- row stays or becomes a draft: forces the five totals columns to NULL;
- row becomes non-draft (UPDATE from draft, or INSERT directly non-draft): **overwrites**
  the totals with the result of the function of section B on the document's items and
  `new.timbre_fiscal`, whatever the caller sent;
- row already non-draft: does nothing (`guard_documents` has already frozen it).

It needs no extra lock: the row being updated is already locked, and item writers wait on
their `FOR SHARE` then get DF014. `finalize_document` computes the totals itself first
(it needs them for the checks of section C), then the trigger recomputes the same values
during its UPDATE. Twice the same cheap query, in exchange for one rule for every role.

Why overwrite and not verify: the fixtures keep working unchanged (plan change D becomes
"no fixture needs adapting": `mark_sent` gets real totals from its one item; the two
direct INSERTs have no item yet and get zeros), and there is no way to be wrong.

Alternatives considered:
- *No trigger, finalize only.* Simplest, but wrong totals are possible for a privileged
  role and every fixture must compute totals by hand. Rejected.
- *Totals maintained on drafts by an items trigger.* Always fresh, but it is a second
  write on every keystroke-save, a lock on the parent for each line, and a stored value
  that looks official on a document that is not. Rejected (matches your preference).
- *A view computing totals on the fly.* Nothing frozen: a later change of the function
  would change issued documents. Rejected.

Not stored: per-line totals (no generated column, unlike `phase2-plan.md`). The issued
view shows `lineTotalHT()` from `money.ts`; the vectors prove it equals what the server
summed. See question I-3.

### B. One totals function

```
private.compute_totals(p_lines private.document_line[], p_timbre numeric)
returns table (line_totals numeric[], tva_breakdown jsonb, total_ht numeric,
               total_tva numeric, total_ttc numeric, net_a_payer numeric)
```

- `private.document_line` is a composite type `(quantity numeric, unit_price numeric,
  tva_rate numeric)`. The function takes **lines as an argument, not a document id**: that
  is what lets the vector script call it on a `VALUES` list without writing a row, and
  lets finalize and the trigger call it on `document_items`.
- Rule B exactly: `round(quantity * unit_price, 3)` per line; per rate, base = sum of the
  rounded lines, TVA = `round(base * rate / 100, 3)` once; `total_ttc = total_ht +
  total_tva`; `net_a_payer = total_ttc + coalesce(p_timbre, 0)`. The timbre is added after
  TVA and is not subject to it. No line: all zeros, `tva_breakdown = '[]'`.
- `tva_breakdown`: array sorted by rate, rate 0 included, every value as **text with 3
  decimals**: `[{"rate":"19.000","base":"160.000","tva":"30.400"}]`.
- Results are plain `numeric`, not `numeric(12,3)`: the function never fails on a large
  total, the caller decides (finalize raises a DF code, the script writes
  `MoneyRangeError`). Since nothing is negative, "anything exceeds the maximum" is the
  same as `net_a_payer > 999999999.999`.
- `language sql`, `immutable`, **not** SECURITY DEFINER (it reads no table),
  `set search_path = ''`, fully qualified names.
- Privileges: `REVOKE ALL ... FROM public, anon, authenticated, service_role`. Callers:
  `finalize_document` and the trigger function (both run as the owner) and the scripts
  (`docker exec psql -U postgres`). The frontend can never call it, which is intended.

Both scripts (`generate-money-vectors.mjs` and `test-e2e-items.mjs`) drop their copy and
call the function. A pgTAP test asserts that the body of `finalize_document` and of the
trigger contain `private.compute_totals` and contain no `round(`: the oracle is then the
production code, and a future copy-paste is caught.

Alternatives: parallel arrays (no new type, but three arrays that must stay aligned);
`jsonb` input (no type either, but text is cast to numeric inside the function, one more
place to get wrong); a function taking a document id (cannot serve the vectors without
writing rows). The composite array is the most typed for the least code.

### C. `finalize_document` with an expected total

New signature, no default, no overload:

```
public.finalize_document(p_document_id uuid, p_expected_net_a_payer text) returns public.documents
```

- The frontend sends `toDbNumeric(totals.netAPayer)`, e.g. `"1190.600"`. It is compared
  **as text** with the server value: `p_expected_net_a_payer is distinct from
  v_net::numeric(12,3)::text`. The user text is never cast to numeric, so NULL, `"1190.6"`,
  `"1e3"` or garbage are all simply "different", with no cast error to handle.
- New checks, placed after DF007 and **before** the counter is touched:
  1. compute the totals (section B) with the timbre that will be snapshotted;
  2. net above `999999999.999` -> **DF023**;
  3. `total_ttc = 0` -> **DF022**;
  4. expected text differs -> **DF009**. Nothing is issued, no number is consumed.
- Timbre snapshot becomes `case when type = 'facture' and enabled then amount end`.

Codes:

| Code | Meaning | Note |
|---|---|---|
| **DF009** | The total the user confirmed is not the total the server computed | last free slot in the finalize block |
| **DF022** | Total TTC is zero | compared on `total_ttc` (HT + TVA), so a facture of zero plus a timbre is refused too |
| **DF023** | A total exceeds `numeric(12,3)` | not in your list; without it the user gets a raw `22003` |
| **DF007** | Timbre enabled without amount | **kept, not renumbered**: it already means exactly this |

On DF007: after the CHECK of section F the state cannot exist, so the branch becomes a
second line of defence. I recommend keeping it (it costs three lines and survives someone
dropping the CHECK) and testing it by dropping the constraint inside the pgTAP
transaction, which is rolled back.

Signature change, in one migration (one transaction):
1. `DROP FUNCTION public.finalize_document(uuid);` (not `CREATE OR REPLACE`: with a
   different argument list that would create an overload and leave the old one callable).
   Nothing depends on it in the schema; `tests.finalize_as` is plpgsql and resolved at call time.
2. `CREATE FUNCTION public.finalize_document(uuid, text)`, SECURITY DEFINER, `search_path = ''`.
3. `REVOKE ALL ... FROM public, anon, authenticated, service_role;` then
   `GRANT EXECUTE ... TO authenticated;` (a new function gets the default grants again).
4. `NOTIFY pgrst, 'reload schema';` so PostgREST forgets the old signature.

A stale client that still sends one argument gets `PGRST202` (function not found): it
fails closed. pgTAP asserts `to_regprocedure('public.finalize_document(uuid)') is null`.

Alternative: a default value for the new parameter. Rejected: the check would be optional,
and the call the frontend forgets is exactly the one it exists for.

### D. Stored columns: names and meaning (all TODO(accountant))

| Column | Type | Definition | On a devis |
|---|---|---|---|
| `total_ht` | `numeric(12,3)` | sum of the rounded line totals | same |
| `total_tva` | `numeric(12,3)` | sum of the per-rate TVA | same |
| `total_ttc` | `numeric(12,3)` | `total_ht + total_tva`, **never the timbre** | same |
| `timbre_fiscal` | `numeric(12,3)` (exists) | the droit de timbre charged; NULL = none | always NULL |
| `net_a_payer` | `numeric(12,3)` | `total_ttc + coalesce(timbre_fiscal, 0)` | `= total_ttc` |
| `tva_breakdown` | `jsonb` | per-rate table, text amounts (section B) | same |

All five new columns are NULL on a draft and non-null on anything else. No grant: the API
role reads them (table-level SELECT) and cannot write them. Two CHECKs make the names
true for every role: `total_ttc = total_ht + total_tva` and
`net_a_payer = total_ttc + coalesce(timbre_fiscal, 0)`. With them no stored value can be
read two ways, and the screen labels map one to one: Total HT, TVA, Total TTC, Droit de
timbre, Net à payer.

`timbre_fiscal` keeps its name: it is already the snapshot, already frozen, already
tested. Renaming it to `timbre` would touch `004`, `005`, `006` and the types for no gain.

What changes in `src/lib/money`:
- `Totals.totalTTC` changes meaning to HT + TVA; new `Totals.netAPayer` = TTC + timbre.
  The range error is raised on `netAPayer`.
- `vectors.json`: `expected` gains `netAPayer`, `totalTTC` loses the timbre, the `format`
  line is updated. The 600 generated vectors are regenerated by the script. The
  hand-written ones are **edited by hand** (the script never rewrites them, it only
  refuses to run if one disagrees with Postgres): unchanged where `timbre` is null except
  for the new key, `totalTTC` lowered where a timbre is given.
- `money.test.ts` (3 direct assertions on `totalTTC` plus the vector mapping), and 100 %
  coverage must still hold.

Later phases read `net_a_payer`: DF018 and DF019 compare payments with it, not with
`total_ttc`. `phase2-plan.md` decision 2 and migration 4 say `total_ttc`; they need a
one-line correction when P2e starts.

Migration path: purely additive. There is no issued document locally and no remote
database, so there is nothing to backfill. If the migration ever ran on a database that
has a non-draft document, the new `documents_issued_is_complete` would fail and stop it,
which is the right outcome: totals of an already-issued document must not be invented
silently.

Alternative: keep `total_ttc` = HT + TVA + timbre and add nothing. Rejected: it is the
ambiguity the accountant pointed at, and "TTC" on a printed facture would not equal
HT + TVA.

### E. Timbre rules

1. Only on factures: finalize snapshots it only when `type = 'facture'`.
2. Never on a devis, for every role: `CHECK (type <> 'devis' OR timbre_fiscal IS NULL)`
   (`documents_devis_has_no_timbre`). It also holds on drafts, where the column is NULL.
3. Also add `CHECK (timbre_fiscal >= 0)` on `documents`: the source column has it, the
   snapshot does not.
4. Facture with the timbre enabled and no amount: refused (DF007, kept), and made
   impossible at the source by the CHECK of section F.

Rows of the local database that would violate the new CHECKs:

| Check | Violating rows |
|---|---|
| `tax_settings`: enabled implies amount | **0** (of 3) |
| `documents`: no timbre on a devis | **0** (no devis exists) |
| `documents`: issued requires totals | **0** (no non-draft document exists) |
| `documents`: `timbre_fiscal >= 0` | **0** |

### F. New CHECKs and order

- `tax_settings_timbre_enabled_has_amount`: `CHECK (NOT timbre_enabled OR timbre_fiscal IS NOT NULL)`.
  0 violating rows. The settings form already refuses this (`settings.tax.timbreRequired`
  in `schemas.ts`), so the CHECK only adds the every-role layer. A direct API write gets `23514`.
- `document_items_description_length`: `CHECK (length(description) <= 500)`. 0 violating
  rows (longest: 15). Postgres counts characters, JavaScript `.length` counts UTF-16
  units, so the screen is never more permissive than the database.
- Other free text (`documents.notes`, client and organization fields): no limit today
  and none proposed here; see question I-6.

Order inside P2d2 (each step checks its rows first, with a `SELECT` shown in the report):
tax_settings CHECK, then items CHECK, then the totals function, then the columns and
CHECKs on documents, then the trigger, then finalize v2. The two simple CHECKs go first
because they are independent and the cheapest to roll back if a row surprises us.

### G. Test plan

**pgTAP, new file `008_totals.test.sql`**
- `compute_totals`: no line; one line; a line tie (0.0005 -> 0.001); half-up not half-even
  (1.5 and 2.5 x 0.001); TVA tie; two rates; rate 0 present in the breakdown; timbre
  added after TVA; a result above `numeric(12,3)` returned without error. Values copied
  from the hand-written vectors, so the two suites cite the same cases.
- Parity: the hand-written vectors inlined as a `VALUES` list and compared with the
  function (pgTAP cannot read `vectors.json`; the 600 random ones are covered by
  `money:vectors`, which now calls the same function).
- Structure: finalize and the trigger call `private.compute_totals`, contain no `round(`;
  the function is not executable by `anon`, `authenticated`, `service_role`.
- Trigger: a draft never stores totals even when a privileged role sets them; `mark_sent`
  yields the right totals; a privileged `status = 'sent', total_ht = 1` is overwritten;
  totals of an issued document cannot change (DF011); direct non-draft INSERT gets zeros.
- CHECKs: each of the new ones, by name.

**pgTAP, `005_finalize_document.test.sql` (extended)**
- DF009: wrong amount, NULL, `"100.0"`, `"100"`, `"1e2"`, `" 100.000"`; each leaves the
  document a draft and the counter untouched.
- DF022: all prices zero; all prices zero on a facture with a timbre.
- DF023: a line near the maximum with a rate that pushes the net over it.
- DF007: reached by dropping the CHECK inside the test transaction.
- Devis of an organization with timbre enabled and an amount: `timbre_fiscal` NULL,
  `net_a_payer = total_ttc`. Facture: timbre snapshotted, `net_a_payer = total_ttc + timbre`.
- Organization without a `tax_settings` row: issued, no timbre.
- Stored totals equal `compute_totals` on the stored items; `tva_breakdown` values are JSON strings.
- `finalize_document(uuid)` no longer exists; the privilege tests of `001` use the new signature.

Existing tests affected (to be listed line by line before anything changes, plan change E):
`001` lines 258 to 264 and 320 (signature); `005` every call (16 mentions) and the timbre
section, lines 140 to 155, which sets `timbre_enabled = true` with a NULL amount and will
now hit the CHECK; `tests.finalize_as` in `000`; `006` section G (seven "missing field"
cases stay valid; the "all seven fields" wording changes). `004`/`006` fixtures: no change
expected thanks to the overwrite trigger. I have not run the suite against the design, so
this list is from reading, not from a failing run.

**Mutation checks** (break, show the failing test, restore):
1. `round(x, 3)` -> `trunc(x, 3)` in the function: tie vectors fail in pgTAP and in `money:vectors`.
2. TVA rounded per line instead of per rate: the two-lines-one-rate vector fails.
3. Timbre added before TVA (in the base): timbre vectors fail.
4. Remove the DF009 comparison: the mismatch tests fail.
5. Compare as numeric instead of text: `"100.0"` is accepted, test fails.
6. Remove `type = 'facture'` from the snapshot: the devis test and the CHECK fail.
7. Trigger verifies nothing / is dropped: the "privileged wrong total" test fails.
8. Paste the formula back into finalize: the structure test fails.
9. Drop each new CHECK: its named test fails.
10. TypeScript: `netAPayer` without the timbre, `totalTTC` with it: vectors fail.

**`test:concurrency` must still prove** scenarios 0 to 6 unchanged (numbers 1..N, rollback
consumes nothing, one winner with DF002, items race, delete race, one organization), with
the new second argument, and additionally:
- every issued document's stored totals equal `compute_totals` on the items stored at the
  end (in the items race: an insert that won is in the total, one that lost is not);
- a finalize refused with DF009 under contention consumes no number and leaves no gap.

Also to run and report in P2d2: `test`, `lint`, `typecheck`, `build`, `test:coverage`,
`test:db`, `test:concurrency`, `test:e2e-auth`, `test:e2e-settings`, `test:e2e-documents`,
`test:e2e-items`, `money:vectors` (must produce a byte-identical file on a second run).

### H. P2d2 content, in order

**Migrations (new files, one concern each, following the existing naming)**
1. `tax_settings_timbre_check`: the CHECK of section F.
2. `document_items_description_length`: the CHECK of section F.
3. `compute_totals`: type `private.document_line`, function `private.compute_totals`,
   REVOKEs.
4. `document_totals_columns`: the five columns; `documents_draft_has_no_totals`;
   `documents_devis_has_no_timbre`; `timbre_fiscal >= 0`; the two arithmetic CHECKs;
   non-negative totals; drop and re-create `documents_issued_is_complete` with the five
   columns added.
5. `document_totals_trigger`: `private.set_document_totals()` and its trigger, REVOKEs.
6. `finalize_document_v2`: drop, create, REVOKE/GRANT, NOTIFY.

**Tests and scripts**: `000` (`finalize_as` takes the expected total), `001`, `005`,
`006` wording, new `008`; `generate-money-vectors.mjs` and `test-e2e-items.mjs` call the
function; `test-concurrency.mjs`, `test-e2e-documents.mjs`, `test-e2e-items.mjs` pass the
second argument and check stored totals.

**TypeScript**
- `src/lib/money/money.ts`, `money.test.ts`, `vectors.json`: section D.
- `src/types/database.types.ts`: regenerated, never edited.
- `src/features/documents/api.ts`: `finalizeDocument(organizationId, documentId,
  expected)`; issued columns selected as text (`total_ht::text`, ..., `net_a_payer::text`,
  `timbre_fiscal::text`, `tva_breakdown`); a strict reader for `tva_breakdown` (strings
  only, through `fromDbNumeric` / `fromDbRate`).
- `payload.ts` + `payload.test.ts`: a `finalizePayload()` with exactly two keys, the
  second a string built by `toDbNumeric`; the test proves it is never a number.
- `preview.ts`, `TotalsPreview.tsx`: five rows (Total HT, TVA, Total TTC, Droit de
  timbre, Net à payer); still labelled as a preview on a draft.
- New: confirmation step before finalizing (shows the net à payer that will be sent),
  and a read-only issued view built from the stored columns only.
- `src/lib/errors.ts` + `fr/translation.json`: DF009, DF022, DF023. DF009 message: the
  totals changed, reload and check again.
- Finalize is disabled while a line form holds unsaved input: the preview counts the
  pending line, the server does not, and the result would be a DF009 the user cannot
  understand.
- `CLAUDE.md`: codes table, data rules, TODO list; `phase2-plan.md`: decision 9 and the
  `total_ttc` mentions.

### I. Risks and open questions

| # | Question or risk | Recommended answer |
|---|---|---|
| 1 | Which figure does the user confirm: Net à payer or Total TTC? | **Net à payer.** It is the amount owed and it covers the timbre too. |
| 2 | Zero-total refusal on `total_ttc` or on `net_a_payer`? | **`total_ttc`.** Otherwise a facture of 0 plus a timbre is issued. TODO(accountant): is a free facture ever legitimate? |
| 3 | Store per-line totals? | **No, not in P2d.** One more frozen copy and a write on items at issue. Revisit with the PDF. |
| 4 | DF023 (over the maximum) was not in your list. | **Add it.** The alternative is a raw `22003`. |
| 5 | DF007: keep, or a new number? | **Keep DF007.** Same meaning, already translated and tested. |
| 6 | Length limits on other free text (notes, client and organization fields)? | **Separate small checkpoint**, after you choose the limits; snapshots copy these fields, so the limit belongs on the source tables. |
| 7 | The trigger gives zeros to a privileged direct INSERT of a non-draft document (no items yet). | **Accept.** Only a privileged role can do it, it already can today, and the two fixtures need that state. Forbidding non-draft INSERTs for every role is cleaner but removes those fixtures; decide with the avoir design. |
| 8 | Totals are computed twice in one finalize (function body, then trigger). | **Accept.** Same function, same locked rows, a few lines per document. |
| 9 | The timbre used for the check and the timbre snapshotted could differ if settings change mid-call. | No: both come from the one `tax_settings` read in the call. A settings change between preview and click gives DF009, which is the point of the check. |
| 10 | `tax_settings.timbre_fiscal = 0` with the timbre enabled is allowed. | **Leave it.** Harmless (net = TTC). TODO(accountant). |
| 11 | Retenue à la source is still not in any total. | **Unchanged** (decision 2). `net_a_payer` is before retenue; say so on the screen. TODO(accountant). |
| 12 | Hand-written vectors must be edited by hand for the new meaning of `totalTTC`. | I list each edited vector, old and new values, in the P2d2 report before regenerating. |
| 13 | Rule B, half-up, timbre after TVA and outside its base, timbre on factures only, column meanings. | All **TODO(accountant)**; nothing real is issued before the answers. |

### Not verified

- I did not run any test suite for this report (design only), so "existing tests affected"
  comes from reading the files.
- I read `finalize_document` from its migration; I checked in the catalog that one
  function with that name and argument exists with the expected flags and ACL, but I did
  not diff its stored body against the file byte for byte.
- `scripts/test-e2e-settings.mjs` line 231 sends `timbre_enabled: true` alone; I did not
  trace whether an amount is set at that point. To check first in P2d2.
- The generated types were read only around `finalize_document`.
- Accounting rules: none verified; they are the accountant's.
