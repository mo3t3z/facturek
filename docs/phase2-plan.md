# Phase 2 plan (approved 2026-10-13)

> **Historical plan, approved 2026-10-13. For current status see `docs/STATUS.md`.**
> The text below is kept as it was approved, except for the note that follows and one
> correction marked in the P2e decisions. P2a to P2d are finished and merged.

## Where P2d departed from this plan

The design that was actually built is `docs/p2d-design.md`. Differences from the text below:

- **Decision 9, parameter name.** The plan says `p_expected_total_ttc`. The function is
  `finalize_document(p_document_id uuid, p_expected_net_a_payer text)`: the user confirms
  the net à payer, not the total TTC.
- **No generated `line_total_ht` column** (migration 1 below). Per-line totals are not
  stored; the issued view derives them, every other amount is a stored column.
- **`total_ttc` versus `net_a_payer`.** The plan has `total_ttc = total_ht + total_tva +
  coalesce(timbre_fiscal, 0)`. What exists: `total_ttc = total_ht + total_tva` (never the
  timbre) and a separate `net_a_payer = total_ttc + coalesce(timbre_fiscal, 0)`.
- **`scripts/test-totals-parity.mjs` was never created** (folder structure below). Parity
  is proved by `npm run money:vectors` and `npm run test:e2e-items`, which both call
  `private.compute_totals()`, the function that writes the stored totals.
- **The totals trigger also fires on INSERT** and forces NULL totals on a draft; the plan
  only described a `BEFORE UPDATE` trigger.
- **Codes.** The three codes the plan left unnumbered are DF009 (expected total differs),
  DF022 (total is zero) and DF023 (total exceeds the maximum, not in the plan).
- **"TODOs recorded after P2c3", section P2d: all done** (CHECK on `tax_settings`, length
  CHECK on the line description, no timbre on a devis, names of the stored totals). The
  review of the OTHER free-text columns is still open: see `docs/STATUS.md`.
- **"Possible UX bug, to reproduce first": fixed** in `d664661` (the `DecimalField`
  feedback line is reserved, so a click on submit is not lost).
- **"Test data left in the local database" is outdated.** The current accounts are listed
  in `docs/STATUS.md`.
- **Tests.** `008_totals.test.sql` exists; `009_payments_status` and `010_conversion`
  belong to P2e and P2f and do not exist yet. `src/features/payments/` does not exist yet.

Scope: clients UI, then documents (devis / facture) UI, then totals, payments and status.
One checkpoint = one branch from `main`, reviewed and approved before the next one starts.

## Findings that shaped the plan

- `tests.mark_sent()` issues documents by hand (sets `status = 'sent'` without
  `finalize_document()`). Totals must therefore be produced for EVERY role, not only inside
  `finalize_document()`.
- PostgREST returns `numeric` as a JSON number (a float in JavaScript). Every money column
  is selected as text (`total_ttc::text`) and sent back as a string.
- `finalize_document()` currently snapshots the timbre on a devis too. Decision 3 fixes it.

## Checkpoints

| Checkpoint | Content | Migrations |
|---|---|---|
| P2a clients | App shell (nav, phone-first layout), shared form controls in `src/components`, clients list with search, create, edit, delete | none |
| P2b money | Pure module `src/lib/money`, no UI, 100% unit-tested, shared vectors file | none |
| P2c drafts | Settings page (organization identity + tax settings), drafts list, draft editor with items and live preview totals | none |
| P2d finalize + totals | Stored totals, finalize confirmation, read-only issued view | totals columns, totals trigger, new `finalize_document` |
| P2e payments + status | `record_payment`, automatic `paid`, `cancel_devis` | payment rules, `record_payment`, `cancel_devis` |
| P2f conversion | `convert_devis_to_facture(p_devis_id)` | `convert_devis_to_facture` |

Every checkpoint ships with tests and mutation checks (break the rule on purpose, show the
test that fails, restore), and reports the real output of `test`, `lint`, `typecheck`,
`build`, `test:db`, `test:concurrency` and `test:e2e-auth`.
No new devDependency without asking first.

## Decisions

1. **Settings page**: in P2c. No default tax values, with a visible "verify with your
   accountant" notice.
2. **Retenue à la source**: out of Phase 2. The snapshot columns stay.
   TODO: a facture on which the client withholds the retenue cannot reach `paid`, because
   its payments never cover `total_ttc`.
   *(Corrected 2026-10-14: read `net_a_payer`, see the note after decision 6.)*
3. **Timbre**: factures only. `finalize_document` stops snapshotting it on a devis (new
   migration, `CREATE OR REPLACE`, existing tests stay green).
4. **Overpayment** is refused (DF018).
5. **Paid** is automatic inside `record_payment`, and also enforced for every role in
   `guard_documents` (DF019: `sent -> paid` only when payments cover the total).
6. **`paid_at`**: not in the future (Africa/Tunis date) and not before the issue date.
   TODO(accountant).

   > **Correction for P2e (2026-10-14).** Payments are compared with `net_a_payer`, NOT
   > with `total_ttc`. Since P2d, `total_ttc` is HT + TVA without the timbre, and
   > `net_a_payer` is what the client owes. Everywhere decisions 2, 4 and 5 and migrations
   > 4 and 5 below say "the total" or `total_ttc` for a payment (overpayment DF018, paid
   > coverage DF019, automatic `paid` in `record_payment`), read `net_a_payer`.
7. **Roles**: any organization member may finalize, record payments and cancel a devis.
   Revisit with the invitation flow.
8. **Out of scope**: discounts (remise), FODEC, PDF / print, matricule fiscal format
   validation.
9. **Expected total**: `finalize_document` gets a REQUIRED second parameter
   `p_expected_total_ttc text` (no default, no overload). It refuses when the value differs
   from the server-computed total (new code). The privilege tests in `001` are updated to
   the new signature.

## Plan changes

- **A. P2f**: `convert_devis_to_facture(p_devis_id)`, SECURITY DEFINER, atomic, copies the
  items, sets `converted_from`, membership check inside the `WHERE`, DF001 for foreign ids,
  same pgTAP and mutation discipline.
- **B.** `INSERT` on `payments` is revoked from `authenticated`; `record_payment` is the
  only API path. Every existing test this changes is listed before P2e starts.
- **C.** Finalizing a document whose `total_ttc` is 0 is refused (new code, raised in
  `finalize_document`, not a CHECK).
- **D.** Fixtures that insert a non-draft document directly (the cancelled facture in
  `004`, and any other) will violate the extended `documents_issued_is_complete` CHECK.
  They are adapted by giving the fixture what an issued document really has (items and
  totals consistent with them), never by weakening an assertion. The exact list and the
  adaptation of each one is shown in P2d before anything changes.
- **E.** In P2d, before changing anything: count and list the existing tests affected by
  DF018 / DF019 / the new codes, and show the list.
- **F.** Parity script: edge vectors (rounding ties, values near the `numeric(12,3)` limit,
  several rates, zero) plus seeded random vectors, with no new dependency.

## Folder structure

```
src/app/AppLayout.tsx                  nav + outlet, phone first
src/components/                        shared form controls (moved from features/auth)
src/lib/money/                         money.ts, money.test.ts, vectors.json
src/features/clients/                  api.ts, schemas.ts, pages/
src/features/documents/                api.ts, schemas.ts, pages/ (list, editor, view), components/
src/features/payments/                 api.ts, schemas.ts, components/
src/features/settings/                 organization + tax settings
scripts/test-totals-parity.mjs         runs vectors.json against the local database
supabase/tests/008_totals.test.sql, 009_payments_status.test.sql, 010_conversion.test.sql
```

## Migrations (all new files; applied migrations are never edited)

1. **document totals (P2d)**
   - `document_items.line_total_ht`: generated column, `round(quantity * unit_price, 3)`.
   - `documents.total_ht`, `total_tva`, `total_ttc` as `numeric(12,3)` and
     `tva_breakdown jsonb` (rate, base, amount per rate). NULL on a draft, no grant to the
     API role.
2. **totals on issue (P2d)**
   - `BEFORE UPDATE` trigger `private.set_document_totals()`: on draft -> non-draft it
     overwrites the totals from the items, whatever the caller sent. Every role gets
     correct totals.
   - `documents_issued_is_complete` also requires the totals.
   - CHECK: `total_ttc = total_ht + total_tva + coalesce(timbre_fiscal, 0)`.
   - `guard_documents` already freezes any new column of an issued document.
3. **finalize_document v2 (P2d)**: drops `finalize_document(uuid)`, creates
   `finalize_document(uuid, text)`. Timbre snapshot for factures only (decision 3),
   expected-total check (decision 9), zero-total refusal (change C).
4. **payment rules (P2e)**
   - `guard_payments` locks the facture with `FOR NO KEY UPDATE` instead of `FOR SHARE`
     (two concurrent payments can no longer both pass the sum check), refuses overpayment
     (DF018) and applies the `paid_at` rules (decision 6).
   - `guard_documents`: `sent -> paid` only when payments cover the total (DF019).
   - `REVOKE INSERT` on `payments` from `authenticated` (change B).
5. **record_payment (P2e)**:
   `public.record_payment(p_document_id, p_amount, p_paid_at, p_method) returns documents`.
   SECURITY DEFINER, membership inside the `WHERE` (DF001 for a foreign id), locks the
   facture `FOR UPDATE`, inserts the payment, sets `paid` when the sum equals the total.
6. **cancel_devis (P2e)**: `public.cancel_devis(p_document_id) returns documents`. Same
   shape; requires a sent devis (DF012 otherwise); refuses when a facture references it
   through `converted_from`.
7. **convert_devis_to_facture (P2f)**: see change A.

New SQLSTATE codes (final numbers fixed in the checkpoint that introduces them, each added
to `CLAUDE.md`, `src/lib/errors.ts` and the French translations): overpayment (DF018),
paid without coverage (DF019), expected total mismatch, zero total, invalid payment date,
devis already converted.

## Money module API (P2b)

```ts
type Millimes   // branded safe integer, 1 TND = 1000
type QtyMilli   // quantity x 1000
type RateMilli  // percent x 1000 (19 % = 19000)

parseMillimes(text: string): Millimes | null   // "12,5" or "12.500"; rejects >3 decimals, exponents, negatives
parseQuantity(text: string): QtyMilli | null
parseRate(text: string): RateMilli | null
toDbNumeric(value: Millimes): string           // "1234.500"
formatMillimes(value: Millimes, locale: string): string

lineTotalHT(quantity: QtyMilli, unitPrice: Millimes): Millimes
tvaByRate(lines: Line[]): TvaLine[]            // { rate, baseHT, tva }, sorted by rate
computeTotals(input: { lines: Line[]; timbre: Millimes | null }): Totals
// Totals = { lines, tvaLines, totalHT, totalTVA, timbre, totalTTC }
```

- Intermediate products use `bigint` (quantity x price can exceed 2^53).
- A result outside `numeric(12,3)` throws a typed range error.
- No import from React or Supabase; no tax value is ever a default.

## Rounding rule

| Option | Rule | Trade-off |
|---|---|---|
| A | Round TVA on each line, then sum | Simple, but the per-rate TVA can differ by a few millimes from base x rate |
| **B (chosen)** | Line HT rounded to the millime; TVA computed once per rate on the summed base, rounded once | Matches the base / rate / amount table printed on an invoice |
| C | No rounding until the grand total | Printed lines do not add up to the total |

Rounding mode: half-up, exactly what Postgres `round(numeric, 3)` does, so SQL and
TypeScript cannot disagree on a tie.
TODO(accountant): verify the rule before real use.

## Risks

- SQL and TypeScript are two implementations of the totals. The parity script is what keeps
  them equal; it needs the local database, like `test:concurrency`.
- The generated column makes the line rounding rule part of the schema.
- Existing tests in `004` / `006` set statuses and insert payments by hand; P2d and P2e list
  the affected tests before touching them (changes D and E).
- Retenue à la source: see decision 2.

## P2a notes

- The clients list is loaded once per organization and searched in the browser (name,
  matricule fiscal, e-mail, phone). No user text is ever put into a PostgREST filter.
  Limitation: PostgREST returns at most 1000 rows; server-side search and paging come when
  a real organization gets close to that.

## TODO (found during the P2a review)

- `isNetworkError()` in `src/lib/errors.ts` treats EVERY `TypeError` as a network error
  ("what fetch() throws"). A programming bug that throws a `TypeError` inside a query or
  mutation function is therefore shown as "Connexion au serveur impossible" and masked.
  Narrow the test (for example to the fetch failure messages) and add tests.
- `PGRST116` (no row: the client was deleted while its form was open) has a specific
  message only on the client edit screen, through the second argument of
  `errorMessageKey()` (`clients.notFound`). `errors.ts` itself does not know the code, so
  any other screen that uses `.single()` falls back to the generic message. Decide whether
  it gets a generic entry in `DB_CODES` when the documents screens arrive (P2c).

## Notes added after P2b

- **P2d**: the amounts inside `documents.tva_breakdown` (jsonb) must be stored as TEXT with
  exactly 3 decimals (`"19.000"`, `"160.000"`), never as JSON numbers: `fromDbNumeric` /
  `fromDbRate` are strict and a JSON number would be a float in JavaScript.
- **P2c2**: "quantity > 0" is a form rule. `parseQuantity` accepts 0 on purpose (it only
  checks the format and the range); the database CHECK (`quantity > 0`) is the last word.
- **Every merge**: run `npm run test:coverage` (100 % of `src/lib/money`) before merging a
  checkpoint into `main`; it is not part of `npm test`.

## TODOs recorded after P2c3 (2026-10-13)

### P2d
- **Timbre without an amount.** Add a CHECK on `tax_settings` so that
  `timbre_enabled = true` requires `timbre_fiscal is not null`. Verify the existing rows
  first (a row that violates it would make the migration fail). `finalize_document` must
  keep refusing a facture when the timbre is enabled without an amount (DF007 today).
- **Length of free text.** Add a length CHECK on `document_items.description` matching the
  screen limit (500 characters, `DESCRIPTION_MAX_LENGTH`), and review the other free-text
  columns (`documents.notes`, client and organization fields): none has a limit in the
  database today.
- **No timbre on a devis.** `finalize_document` must not snapshot the timbre on a devis.
  The preview already never adds it to a devis (decision 3).
- **Names of the stored totals.** Decide them after the accountant answers: "total TTC"
  without the timbre versus "net à payer" with it.

### Later
- **Avoir (credit note)** as a document type.
- **TTN / El Fatoora.** Fields such as `ttn_reference`, `ttn_status` and the signed XML
  would be written AFTER a document is issued: they must be columns that
  `guard_documents` does not freeze (today it freezes every column except `status` and
  `updated_at`). TEIF export as a separate module.
  The external facts behind this (El Fatoora obligation from 2026, the TTN portal,
  TunTrust certificate prices, 2-year validity) are UNVERIFIED references, pending the
  answers of the accountant and of TTN. Nothing may be built on them yet.

### Possible UX bug, to reproduce first
- The reading shown by `DecimalField` when a field is left ("= 1 500,000 TND") adds a line
  under the field. It may shift the layout and make the first click on the submit button
  miss. Pending a manual reproduction: nothing is changed until it is confirmed.

### Test data left in the local database
- Account `p2c3-manual-20261013@example.test`, organization "Test Manuel P2c3", client
  "Client Documents A". The before/after counts of future reports include them.
