# Project status

Last updated: 2026-10-14, written on `checkpoint/docs-status` from `main` at `2e83915`.

This file says where the project IS. It is updated in every checkpoint, before the merge
into `main`. The rules of the project are in `CLAUDE.md`; the plan as it was approved is
in `docs/phase2-plan.md`; the design of P2d is in `docs/p2d-design.md`.

Nothing is deployed and no remote database exists: everything below is local.

## a. Done checkpoints

Merges into `main` are fast-forward only, so there is no merge commit: the tip of the
checkpoint branch is the reference, and it is an ancestor of `main`.

| Checkpoint | What it delivered | Branch tip on `main` | Date |
|---|---|---|---|
| b-tenancy | Organizations, members, RLS helpers, clients, tax settings | `e43c291` | 2026-10-12 |
| c1-documents | Documents, items, payments: tables, constraints, RLS | `18d50ac` | 2026-10-12 |
| c2-numbering | Counters and `finalize_document()`, gapless numbers | `a5398fb` | 2026-10-12 |
| c3-immutability | Guard triggers: issued documents, items and payments are frozen | `48248cf` | 2026-10-12 |
| d1-signup | Account provisioning at signup, `ensure_my_account()` | `46a0ae5` | 2026-10-12 |
| d2-auth-ui | Signup, login, e-mail confirmation, password recovery screens | `8a1696d` | 2026-10-12 |
| p2-plan | The Phase 2 plan and its decisions | `09bfbfc` | 2026-10-13 |
| P2a clients | App shell, shared form controls, clients list / create / edit / delete | `df36348` | 2026-10-13 |
| P2b money | `src/lib/money`: integer millimes, rounding rule, vectors | `f1c500e` | 2026-10-13 |
| P2c1 settings | Settings page: organization identity and tax settings | `ef2175f` | 2026-10-13 |
| P2c2 documents | Drafts: list, create, edit header, delete | `8311d62` | 2026-10-13 |
| P2c3 items | Lines of a draft, live totals preview | `574c3f8` | 2026-10-13 |
| P2d1 design | The P2d design and its decisions (docs only) | `fc4f722` | 2026-10-13 |
| P2d2a totals | `private.compute_totals()`, stored totals and their trigger, new CHECKs, timbre on factures only | `3351c16` | 2026-10-13 |
| P2d2b finalize v2 | `finalize_document(uuid, text)` with the expected net à payer; DF009, DF022, DF023 | `b901dd2` | 2026-10-14 |
| P2d3 issue UI | "Émettre" with its confirmation, read-only issued view, net à payer in the list | `2e83915` | 2026-10-14 |

The branch `checkpoint/p2-plan` itself points at `8a1696d`; the plan was committed on
`main` as `09bfbfc`. Two fix branches were merged between checkpoints: a wrong expectation
in the clients phone search tests (`1ec7ce1`) and the `DecimalField` layout shift that
could swallow a click (`d664661`).

## b. Remaining checkpoints, in order

| # | Checkpoint | Scope | Must be decided or known first |
|---|---|---|---|
| 1 | **P2e payments and status** | DONE, merged into `main` at `f231325`. Design: `docs/p2e-design.md`. | The `paid_at` rules (TODO(accountant)); P2e ships without them (decision E-6). |
| 2 | **P2f conversion** | DONE, merged into `main` at `bb00017`: `convert_devis_to_facture(p_devis_id)` (one transaction: draft facture, copy of the lines, link), ONE facture per devis (DF025 + unique index), "Créer la facture" on a sent devis. | Decided 2026-10-15: one facture per devis. |
| 3 | **Free-text length CHECKs** | DONE, merged into `main` at `eff0d00` (migration `20261015100001`). Limits = the screens'. | - |
| 4 | **Avoir (credit note)** | The only way to correct or cancel a numbered facture. | Design DRAFT in `docs/avoir-print-design.md` (option proposed: a separate `avoir` type with its own series), blocked on questions C1 to C6. Accounting rules, numbering series, link to the corrected facture. |
| 5 | **PDF / print (document de présentation)** | A printable facture and devis. | Design DRAFT in `docs/avoir-print-design.md` (browser print first), blocked on questions C7 to C12. Mandatory mentions (TODO(accountant)); whether per-line totals must then be stored. |
| 6 | **Dashboard** | Not planned in detail. | What it should show. |
| 7 | **Invitations** | Tokens, accepted by the invited user, membership created by a SECURITY DEFINER function. | Roles per action (today any member may finalize). |
| 8 | **TTN / TEIF (El Fatoora)** | TTN fields writable after issue, TEIF export as a separate module. | Every external fact is unverified (see section d). Nothing may be built on them yet. |
| 9 | **Deployment** | Prepared on `checkpoint/deploy-prep`, not merged yet: checklist `docs/DEPLOYMENT.md`, security headers (`src/lib/securityHeaders.ts`, `dist/_headers`, checked under `npm run preview`). Nothing remote. | The accountant gate; the replay of every migration on an empty database (`db:reset`, needs consent); the host. |

Also open, not attached to a checkpoint yet: payment corrections by reversal entry
(payments are append-only, DF017); ownership transfer and account deletion (the last owner
cannot leave, DF020). Done on 2026-10-15 (`checkpoint/s8-todos`): `isNetworkError()` no
longer treats every `TypeError` as a network error; `PGRST116` has a generic message; the
cleanup of the e2e and concurrency scripts deletes only organizations whose every member
is a user of the run.

## c. Test inventory

The database counts below were produced on 2026-10-15 at `4ca7dc0`, on a database rebuilt
from EMPTY by `npm run db:reset` (every one of the 25 migrations replayed without error).
The other counts were produced on the same day by running the command. Every command
exited with code 0.

| Command | What it proves | Needs Docker | Result of the run |
|---|---|---|---|
| `npm test` | Unit and component tests (Vitest) | no | 24 files, 1044 tests passed |
| `npm run test:coverage` | 100 % coverage of `src/lib/money` | no | 312 tests; statements 79/79, branches 29/29, functions 31/31, lines 72/72 |
| `npm run lint` | ESLint | no | no finding |
| `npm run typecheck` | `tsc -b` | no | no error |
| `npm run test:db` | pgTAP: schema, RLS, guards, finalize, totals, text lengths, payments, conversion | yes | 12 files, 743 tests, PASS |
| `npm run test:concurrency` | Real parallel connections: numbering, races, expected total, payments, conversion | yes | 11 scenarios (0 to 10), 55 checks passed |
| `npm run test:e2e-auth` | Signup, confirmation, login, recovery through the local APIs | yes | 5 steps, 36 checks passed |
| `npm run test:e2e-settings` | Settings through REST: numerics as text, RLS isolation | yes | 5 steps, 26 checks passed |
| `npm run test:e2e-documents` | Drafts and finalize through REST, including PGRST202 and DF009 | yes | 6 steps, 42 checks passed |
| `npm run test:e2e-items` | Lines through REST; `computeTotals` against Postgres; stored totals | yes | 6 steps, 36 checks passed |
| `npm run test:e2e-payments` | Payments and cancel_devis through REST: no direct INSERT, amount as text, DF018, automatic paid, DF021, isolation | yes | 7 steps, 24 checks passed |
| `npm run money:vectors` | Regenerates the vectors from `private.compute_totals()` | yes | 22 hand-written agree, 600 generated (577 with totals, 23 over the maximum); run twice, byte-identical |

Replay from empty: `npm run db:reset` on 2026-10-15 (with the developer's consent) applied the
25 migrations in order with no error, then `test:db`, `test:concurrency`, the five e2e
scripts and `money:vectors` passed on that new database; the regenerated vectors and
`database.types.ts` were byte-identical to the committed ones.

`npm run build` is not a test; it passed at `4ca7dc0` and writes `dist/_headers`.

## d. Open questions

### TODO(accountant)

Nothing real may be issued before these are answered.

| Question | Where it lives |
|---|---|
| The rounding rule: line rounded half-up, TVA rounded once per rate (option B) | `private.compute_totals()`, `src/lib/money/money.ts` |
| The timbre fiscal: on factures only, added after TVA and not subject to it; when it applies | `finalize_document()`, `tax_settings`, CHECK on `documents` |
| Names and meaning of the totals: total TTC = HT + TVA; net à payer = TTC + timbre | columns of `documents`, `Totals` in `money.ts` |
| Is a facture with a total of zero ever legitimate? It is refused today (DF022) | `finalize_document()` |
| Are the seller's matricule fiscal and address mandatory on a facture? Today only the seller name is required; the confirmation warns | `finalize_document()`, `IssuePanel` |
| The number format shown (`2026-0001`), and whether the type must appear in it | `formatDocumentNumber()` |
| The two date rules of finalize: no future issue date; dates follow numbers | `finalize_document()` |
| The status transition map (draft -> sent; facture sent -> paid; devis sent -> cancelled) | `guard_documents()` |
| The `paid_at` rules planned for P2e: not in the future, not before the issue date | P2e |
| Retenue à la source: out of Phase 2 and in no total. A facture on which the client withholds it could never reach `paid` | `docs/phase2-plan.md`, decision 2 |
| A timbre amount of zero with the timbre enabled is accepted | `tax_settings` |

### TTN / El Fatoora

UNVERIFIED, pending the accountant and TTN: the El Fatoora obligation from 2026, the TTN
portal, TunTrust certificate prices and their 2-year validity. If confirmed, fields such
as `ttn_reference`, `ttn_status` and the signed XML would be written AFTER a document is
issued, so they must be columns that `guard_documents` does not freeze (today it freezes
every column except `status` and `updated_at`).

## e. Known risks and accepted limits

- **DF009 compares only the net à payer, not the content.** Two edits made elsewhere that
  keep the net à payer equal pass the server check. To revisit with the avoir / TEIF work
  (for example a hash of the content sent with the expected total).
- **Stale-screen guard.** An irreversible confirmation is bound to the values it displays
  and closes if they change behind it (`sameTotals` in `IssuePanel`, after the bug fixed in
  `78a6461`). It also compares HT, TVA, timbre and the table by rate, but it only helps on
  a screen that has reloaded: a screen that never reloads relies on DF009 alone.
- **A draft with 1000 lines or more is loaded truncated** (PostgREST `max_rows`): its
  computed total would differ from Postgres and issuing would always answer DF009. The
  documents and clients lists have the same 1000-row limit.
- **Totals exist in two implementations**, SQL and TypeScript. The vectors and
  `test:e2e-items` keep them equal; both need the local database.
- **The session is readable by JavaScript** (SPA with supabase-js): any XSS could steal
  it. Defences are listed in `CLAUDE.md`; the strict CSP is a deployment TODO.
- **A privileged role** (service role, SQL editor) can insert a document directly as
  non-draft: it gets zero totals. It can also issue by hand a document whose totals do not
  fit `numeric(12,3)`, which fails with a raw `22003`.
- **The seller warnings of the confirmation are silently absent** if the organization
  details fail to load.
- **Line totals of an issued document are derived**, not stored (decision I-3); every
  other amount of the issued view is a stored column.
- **Any member may finalize**, record payments and cancel: roles per action wait for the
  invitation flow.
- **A numbered facture cannot be cancelled at all** until avoirs exist.

## f. Manual checks still pending

Done on 2026-10-14, on the p2c3 test account, read as page text only: the issue button and
its reasons, the confirmation (totals, seller warnings, focus on "Annuler"), cancelling,
issuing for real, a double click, the issued view, the list column, the two-tab DF009 case,
an issued document opened by its URL, the live preview, invalid values, the timbre row, and
a devis draft of an organization without a tax settings row.

Done on 2026-10-15, with screenshots (first time the layout was SEEN), on a new throwaway
account (`s8-layout-20261015@example.test`): login, settings, clients (list, form), documents
(form, draft, lines editor, totals preview, issue panel, confirmation, issued view, list),
at desktop width (about 800 px) and phone width (375 px). Result: no horizontal overflow at
375 px, no console error, no broken layout. Keyboard in the confirmation: focus starts on
"Annuler" with a visible ring; Tab order is logical; Escape does NOT close it (inline panel,
not a modal; accepted). Not seen: tablet width, dark mode, a long document (many lines).

Also done on 2026-10-15, on the same account, on the real screen: DF005 (future date) and
DF006 (date before the previous facture) show their French message; DF002 with two tabs
(the second tab ends on the issued view, no second number); the seller warnings disappear
once matricule and address are filled. DF008 cannot be reached from the screen: the header
form already refuses a due date before the issue date. DF003, DF004, DF007, DF022 and DF023
cannot be reached either: the button is disabled first (covered by `issue.test.tsx`).
Bug found and fixed: a refusal stayed on screen after the header was corrected; it now
goes as soon as the header or a line is edited.

P2e3, checked in a browser on 2026-10-15 with screenshots, on the account above, at desktop
width and at exactly 375 px (block and confirmation; page width 375, no element wider):
the payments block of a sent facture, the form (empty amount, today proposed, no
method), the confirmation (amount, day, method, remaining before and after; focus on
"Annuler"), a full payment that turned the facture to "Payée" with no form left, and a devis
issued then cancelled through "Annuler le devis" (focus on "Retour"). Found there: a click
on the button that opens a confirmation can land on its confirm button once it appears; a
payment of 20,500 was recorded that way. Fixed for the three confirmations: the second click
of a double click (detail 2) is ignored (tests in issue.test.tsx and paymentsPanel.test.tsx).
Not seen: DF018 and DF021 on the real screen (covered by component and e2e tests).

P2f, checked in a browser on 2026-10-15 on the same account: a devis issued, "Créer la
facture" (confirmation on "Retour"), the new draft facture opened with the same line and
the same net à payer, and the devis then showing only a link to it (no conversion, no
cancellation), at desktop width and at exactly 375 px (page width 375).

Still pending:
- An organization without a tax settings row, on a FACTURE draft (needs deleting that row
  by hand on a test account).
- The auth screens (confirm page, recovery) at phone width.

## g. Local test data

The local database was rebuilt EMPTY by `npm run db:reset` on 2026-10-15: it holds no
account and no document. The accounts listed here before (the reference account
`d2-browser-...`, `p2a-manual-...`, `p2c3-manual-...`, `moetez.ayed404@gmail.com`,
`s8-layout-...`) no longer exist, and the reference fingerprint is gone with them.
Passwords are never written in this repository's tracked files.

For the next manual check, create a new account through the signup screen and record it
here. The test scripts create throwaway users and remove them.
