# P2e design: payments and status (Sprint 7, design only)

Written 2026-10-15 on `checkpoint/p2e-design` from `main` (`d450624`). Nothing here is
built: no migration, no SQL, no application code. It waits for the developer's approval,
like `docs/p2d-design.md` did.

Out of scope on purpose: the `paid_at` rules (TODO(accountant)), the retenue à la source,
correcting a payment (payments stay append-only, DF017), avoirs, roles per action.

Sources: the local database (catalog queries), `supabase/tests`, `scripts/`, `src/`.

---

## Part 1. Facts

### 1. `public.payments` today

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` | default `gen_random_uuid()` |
| `organization_id`, `document_id` | `uuid` | composite FK to `documents(organization_id, id)`, `ON DELETE RESTRICT` |
| `amount` | `numeric(12,3)` | CHECK `amount > 0` |
| `paid_at` | `date` | NOT NULL, no other rule |
| `method` | enum `payment_method` | `cash`, `virement`, `cheque` |
| `created_at` | `timestamptz` | default `now()` |

- `authenticated` has SELECT on every column and **INSERT** on `organization_id,
  document_id, amount, paid_at, method`. Policy `payments_insert`: member of the
  organization, and the document is a `facture` whose status is `sent`.
- Trigger `private.guard_payments()` (every role): UPDATE and DELETE refused (DF017);
  INSERT refused unless the document is a sent facture (DF016). It locks the document
  `FOR SHARE`.
- **There is no limit on the sum.** Nothing stops payments from exceeding the net à payer.
- **Nothing sets `paid`.** The API role cannot write `status`; only a privileged role can,
  and `guard_documents()` allows `facture sent -> paid` without looking at the payments.
- `devis sent -> cancelled` is allowed the same way, by a privileged role only. The API
  role has no way to cancel a devis today.
- The frontend reads and writes no payment (`src/` has no query on `payments`).

### 2. Tests that insert payments or set a status by hand

This is the list S7-0 asked for: every one of them is touched by the decisions below.

| File | What | Count | Effect of P2e |
|---|---|---|---|
| `004_documents` | Payments inserted **as the API role** (lines 65, 94, 201 to 221, 251) | 10 | Must become refusals (42501), or move to `record_payment()` |
| `004_documents` | Payments inserted as superuser (fixtures, lines 20, 23, 274) | 3 | Unchanged (under 100.000) |
| `004_documents` | `status = 'paid'` by superuser with no payment (line 37) | 1 | Refused by DF019: the fixture must pay the 100.000 first |
| `004_documents`, `006_immutability` | `status = 'paid'` / `'cancelled'` as the API role, expected 42501 (lines 122, 206, 207) | 3 | Unchanged |
| `006_immutability` | Payments inserted as superuser (lines 289 to 312) | 7 | Unchanged (DF016 cases and 40.000) |
| `006_immutability` | Payments inserted as the API role (lines 323 to 349) | 7 | Same as `004` |
| `006_immutability` | `status = 'paid'` by superuser with no payment (lines 44, 50, 111, 180, 441) | 5 | Refused by DF019 (111 already fails on DF011) |
| `006_immutability` | Devis cancelled by superuser (lines 53, 66, 181) | 3 | Unchanged |
| `006_immutability` | Line 439: a devis cancelled AFTER a facture was converted from it, expected to succeed | 1 | **Contradicts DF021** (decision E-5) |
| `008_totals` | `status = 'paid'` by superuser with no payment (line 330) | 1 | Refused by DF019 |
| `001_schema_security` | One superuser payment (line 309) | 1 | Unchanged |
| `scripts/*.mjs`, `src/` | none | 0 | none |

Every test document issued with `tests.mark_sent()` has one line and a net à payer of
**100.000** (checked on the local database), so the existing payments (10.000 to 50.500)
stay under the limit of decision E-2.

---

## Part 2. Proposals

### A. One way in: `record_payment()`

```sql
public.record_payment(
  p_document_id uuid,
  p_amount text,          -- "250.000": the exact text toDbNumeric() gives
  p_paid_at date,
  p_method public.payment_method
) returns public.payments
```

- SECURITY DEFINER, `search_path = ''`, executable by `authenticated` only.
- INSERT on `payments` is **revoked** from `authenticated` and the policy `payments_insert`
  is dropped: the function is the only API path, like `finalize_document()`.
- The amount is TEXT for the same reason as the expected total of finalize: a JSON number
  is a float. The function accepts only `^[0-9]{1,9}\.[0-9]{3}$` and refuses anything else
  (`"250"`, `"1e3"`, `"2,5"`, NULL) with a new code **DF024**. Only after that check is it
  cast to `numeric(12,3)`.
- Order of checks: not signed in (DF000); document not found or of another organization
  (DF001, the same answer for both); not a sent facture (DF016); amount format (DF024);
  overpayment (DF018). Then the INSERT.

### B. Overpayment: a trigger, not only the function (DF018)

The sum of the payments of a facture can never exceed its `net_a_payer`, for every role.
So the rule lives in `guard_payments()`, not in `record_payment()`:

- The lock on the document goes from `FOR SHARE` to **`FOR UPDATE`**. With `FOR SHARE`,
  two payments arriving at the same time both read the old sum, both pass, and the facture
  is overpaid. `FOR UPDATE` makes the second one wait for the first and then read the new
  sum. A concurrency scenario proves it (G).
- Compared with **`net_a_payer`** (TTC + timbre), not `total_ttc`: the client owes the
  timbre too.

### C. `paid` is set by Postgres, never by a click (DF019)

- An AFTER INSERT trigger on `payments` sets the facture to `paid` when the sum reaches
  `net_a_payer` exactly (it cannot pass it, B). For every role, so a privileged insert
  behaves the same.
- `guard_documents()` refuses `sent -> paid` while the sum is below `net_a_payer` (DF019),
  for every role. The only way to `paid` is to record the money.
- "Partly paid" and "remaining" are **derived** (`net_a_payer - sum`), never stored, like
  "overdue".
- `paid` stays terminal: no payment can be removed (DF017), so it never goes back.

### D. Cancelling a devis: `cancel_devis()` (DF021)

```sql
public.cancel_devis(p_devis_id uuid) returns public.documents
```

- SECURITY DEFINER, `authenticated` only. Not found / other organization: DF001. Not a
  sent devis: DF012 (the existing transition error).
- Refused with **DF021** if a facture (draft or issued) has `converted_from` = this devis.
  The rule goes into `guard_documents()` on the transition `-> cancelled`, for every role.
- A facture cannot be cancelled at all: it waits for avoirs (unchanged).

### E. Decisions to take

| # | Question | Proposal |
|---|---|---|
| E-1 | Amount sent as text, refused with a new code DF024 when it is not 3 decimals | Yes |
| E-2 | Overpayment refused for every role (trigger), compared with `net_a_payer` | Yes |
| E-3 | `paid` set automatically, and refused by hand while not covered (DF019) | Yes |
| E-4 | Partial payments allowed (several payments per facture) | Yes |
| E-5 | A devis that has a converted facture cannot be cancelled (DF021). Test `006` line 439 says the opposite today and changes | Yes: once a facture exists, the devis was accepted |
| E-6 | `paid_at`: no rule in P2e; the screen proposes today (Africa/Tunis) and the user may change it | Yes, TODO(accountant) |
| E-7 | Any member may record a payment and cancel a devis | Yes, until roles per action |

### F. Screens

- **Issued facture, status `sent`:** a "Paiements" block under the totals: the list
  (date, method, amount), the sum paid, the remaining amount (derived), and a form: amount
  (`<DecimalField>`, empty by default, never pre-filled), date (today by default), method.
- **Confirmation** before sending, bound to the values it shows (rule of `CLAUDE.md`):
  amount, remaining before and after. If the remaining amount changes behind it (another
  tab paid), it closes and says so, like `sameTotals` in `IssuePanel`.
- Once covered, the page shows the status "Payée" and no form.
- **Issued devis, status `sent`:** "Annuler le devis" with an inline confirmation that
  lands on "Retour". Hidden once cancelled.
- Every new code (DF018, DF019, DF021, DF024) in `errorMessageKey()` and the French
  translations. DF018 reloads the payments and asks the user to check the remaining amount.
- The documents list: status "Payée" / "Annulé" (already translated), and nothing else new.

### G. Tests

- **pgTAP, new file `010_payments.test.sql`:** privileges (no INSERT for `authenticated`,
  EXECUTE only for `authenticated`), each refusal in order (DF000, DF001, DF016, DF024
  with `"250"`, `"1e3"`, `"2,5"`, NULL, DF018), exact payment sets `paid`, partial does not,
  DF019 by hand for the superuser, DF021, cancel_devis happy path, RLS isolation (another
  organization gets DF001).
- **Existing pgTAP:** the 17 API inserts of `004` / `006` become 42501 or move to
  `010`; the 6 superuser `paid` updates (004:37, 006:44, 50, 180, 441, 008:330) get a covering payment first; line 439 of `006`
  expects DF021.
- **Concurrency, new scenario:** N connections each pay the remaining amount of the same
  facture at once: exactly one succeeds, the others get DF018, the sum equals the net à
  payer and the status is `paid`.
- **e2e script `test:e2e-payments`:** through REST: INSERT refused, `record_payment` with a
  text amount, a JSON number refused (DF024), overpayment, automatic `paid`, isolation.
- **Vitest:** the payload builder (exactly four keys, amount is a string), the payments
  block (form, confirmation bound to its values, each error), the cancel button.

### H. Order of work (P2e1 to P2e3, one merge each)

1. **P2e1 database:** migration (revoke, drop policy, `record_payment`, guard changes,
   AFTER INSERT trigger, `cancel_devis`), pgTAP, concurrency scenario, `db:types`.
2. **P2e2 plumbing:** payload builders, API functions, error codes and messages,
   e2e script.
3. **P2e3 screens:** payments block, cancel devis, manual check in a browser at two widths.

### I. Risks

- `FOR UPDATE` on a sent facture blocks other writers of that row for the length of a
  payment transaction (a few milliseconds). Nothing else writes a sent facture.
- A facture whose `net_a_payer` is wrong cannot be fixed before avoirs: payments follow
  the stored amount, which is the point.
- The retenue à la source is still in no total: a client who withholds it pays less than
  the net à payer, and the facture never reaches `paid` (already in `STATUS.md`).

## Decisions (approved 2026-10-15)

E-1 to E-7 approved as proposed, with no change. Work starts with P2e1 (database).
