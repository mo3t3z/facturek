# Sprint backlogs

Written on 2026-10-14. One backlog per sprint of `docs/SPRINTS.md`: each user story is
broken into tasks.

- Sprints 1 to 6: the tasks are the real commits (hash in the last column). They are all
  done.
- Sprints 7 to 13: the tasks are a PROPOSAL, derived from section b of `docs/STATUS.md`
  and from the Definition of Done. They are refined at each sprint planning.
- No hours and no story points: nothing was measured. Add an "Estimate" column at the
  first timed sprint planning.

IDs: `S<sprint>-<story>` for a story, `.n` for a task. Status: Done / To do / Blocked.

---

## Sprint 1: Multi-tenant foundation (Done)

| ID | User story | Tasks | Commit |
|---|---|---|---|
| S1-1 | As a developer, I have a project that builds, lints and tests | .1 Project rules in `CLAUDE.md` | `208dbaf` |
| | | .2 Scaffold Vite, React, TS strict, Tailwind, Router, Query, i18n, Vitest, ESLint | `1fb05c5` |
| | | .3 Local Supabase configuration | `76b2881` |
| S1-2 | As an organization, my data is isolated from the others | .1 `private` schema, tenancy tables, last-owner trigger, RLS helpers | `4718d20` |
| | | .2 RLS policies of the tenancy tables | `89aebeb` |
| | | .3 pgTAP: schema security, isolation, roles, escalation | `c4e0984` |
| S1-3 | As a member, I keep clients and tax settings per organization | .1 Tables `clients` and `tax_settings` | `946c584` |
| | | .2 Only the editable columns of `tax_settings` are updatable (test) | `c613674` |
| S1-4 | As an owner, nobody can add themselves to my organization | .1 Remove API INSERT on `organization_members` | `d950ef7` |
| | | .2 Test: no role inserts a membership from the API | `1c35bfe` |
| | | .3 Role changes for owners only; admins remove plain members only | `616e915` |
| S1-5 | Technical | .1 Generated database types, typed client | `8fb4739` |
| | | .2 Documentation: SQLSTATE codes, append-only migrations | `4a6486f`, `e43c291` |

## Sprint 2: Documents in the database, numbered and frozen (Done)

| ID | User story | Tasks | Commit |
|---|---|---|---|
| S2-1 | As an organization, I store devis, factures, lines and payments | .1 Tables with explicit grants | `8ac11aa` |
| | | .2 RLS policies | `a0c5066`, `07c4cc3` |
| | | .3 CHECK: a draft never carries a number | `a7d43c0` |
| | | .4 Updates limited to drafts; payments on sent factures only | `28cedfa`, `18d50ac` |
| | | .5 pgTAP tests | `a752574`, `d26fa00` |
| S2-2 | As an organization, my documents get a gapless number | .1 `document_counters` (RLS on, no policy, no privilege) | `282a59a` |
| | | .2 `timbre_enabled` and the snapshot columns | `3a365b1` |
| | | .3 `finalize_document()` and the Africa/Tunis date helper | `b680719` |
| | | .4 pgTAP: finalize, counters, snapshot privileges | `edb27e3` |
| | | .5 Concurrency test with real connections | `307e4fa` |
| S2-3 | As an organization, an issued document cannot be changed by anyone | .1 Completeness CHECK, immutability and conversion triggers | `4796856` |
| | | .2 Guards on items and payments, locking the parent | `a891104` |
| | | .3 Revoke `document_counters` from `service_role` | `8507ccf` |
| | | .4 Immutability tests for both roles | `f1fc76c` |
| | | .5 Concurrency: item insert / last-item delete racing a finalize | `2b9bea8` |
| S2-4 | Technical | .1 Regenerate types; document the codes and the two-layer rule | `9dd27ed`, `5928882`, `a5398fb`, `48248cf` |

## Sprint 3: A user can sign up and sign in (Done)

| ID | User story | Tasks | Commit |
|---|---|---|---|
| S3-1 | As a new user, my account is created for me | .1 Signup trigger, `provision_account()`, `ensure_my_account()` | `3415f3e` |
| | | .2 pgTAP: signup, repair, privileges | `53948e2` |
| | | .3 Concurrency: parallel `ensure_my_account` calls | `e921583` |
| S3-2 | As a user, I sign up, confirm my e-mail, log in, recover my password | .1 Auth configuration and French e-mail templates | `3b5fd12` |
| | | .2 Env key check, redirect validation, error mapping, messages | `ca2b9c8` |
| | | .3 Auth pages, `AuthProvider`, guards, organization bootstrap, tests | `d3e8642` |
| | | .4 `npm run test:e2e-auth` | `6a1ff3a` |
| S3-3 | As a user, my session cannot be hijacked through a link | .1 Fix the open redirect in `safeRedirectPath` | `4904e2f`, `8a1696d` |
| | | .2 `VITE_SUPABASE_URL` limited to http / https | `f704d72` |
| | | .3 Escape the ampersand in the e-mail links | `a2065c6` |

## Sprint 4: Clients, money module, settings (Done)

| ID | User story | Tasks | Commit |
|---|---|---|---|
| S4-1 | As a team, we have an approved Phase 2 plan | .1 Plan and decisions | `09bfbfc` |
| S4-2 | As a user, I manage my clients | .1 A screen can give its own message for an error code | `9fb5864` |
| | | .2 App shell, shared form controls | `371c596` |
| | | .3 List with search, create, edit, delete | `20d11c6` |
| | | .4 Warning at the 1000-row limit; phone search whatever the spacing | `1a2617d`, `0a7d529`, `1ec7ce1` |
| | | .5 e2e cleanup scoped to the users of the run | `14f2510`, `0ec8c11` |
| S4-3 | As a user, my amounts are exact to the millime | .1 Money module: integer millimes, bigint, half-up per rate | `013e10b` |
| | | .2 Vectors: 22 hand-written, 600 generated by Postgres | `c77802e` |
| | | .3 Tests and 100 % coverage gate | `3578153`, `6fa06af` |
| S4-4 | As an owner, I fill in my identity and my tax settings | .1 `formatRate`, `dbNumeric` | `d918710`, `0d1ee8a` |
| | | .2 `DecimalField` and checkbox controls | `c0cbea4` |
| | | .3 Settings page | `fb56dd0` |
| | | .4 `npm run test:e2e-settings` | `52fcdcb` |
| S4-5 | Technical | .1 Rule: `main` is never red | `ef2175f` |

## Sprint 5: Draft documents with lines and a totals preview (Done)

| ID | User story | Tasks | Commit |
|---|---|---|---|
| S5-1 | As a user, I create, edit and delete a draft | .1 Select and textarea controls, French texts | `c2ba07c` |
| | | .2 Documents list and draft header screens | `f52cb70` |
| | | .3 `npm run test:e2e-documents` | `55e98d5` |
| | | .4 Stable order of the list | `7e6f221` |
| S5-2 | As a user, I manage the lines of a draft | .1 `formatQuantity`, quantity kind of the decimal input | `674ed12`, `cb5b4de` |
| | | .2 Lines editor | `b3cf7de` |
| | | .3 `npm run test:e2e-items` | `64c419d`, `689546e` |
| S5-3 | As a user, I see the totals before issuing | .1 Live totals preview | `b3cf7de` |
| | | .2 Preview without a `tax_settings` row | `a92b71b` |
| S5-4 | Bug | .1 `DecimalField` layout shift that could swallow a click | `d664661` |

## Sprint 6: Issue a document from the screen (Done)

| ID | User story | Tasks | Commit |
|---|---|---|---|
| S6-1 | As a team, we have an approved P2d design | .1 Design and decisions | `24e4ca0`, `fc4f722` |
| S6-2 | As an organization, the totals of an issued document are stored and frozen | .1 `compute_totals`, columns, CHECKs, trigger; timbre on factures only | `b2adced` |
| | | .2 Money: `totalTTC` = HT + TVA, new `netAPayer`; vectors from SQL | `4df3c98` |
| | | .3 Preview rows in the final order | `547ae04` |
| | | .4 pgTAP `008_totals`; scripts check the stored totals | `28f425b`, `c522108` |
| S6-3 | As a user, a document is never issued for a total I did not confirm | .1 `finalize_document(uuid, text)`: DF009, DF022, DF023 | `3d7db8e` |
| | | .2 Scripts and concurrency scenarios 7 and 8 | `0c23cae`, `b901dd2` |
| | | .3 `finalizeDocument`, `finalizePayload`, messages | `e95d6f8` |
| S6-4 | As a user, I issue a draft and see the issued document | .1 "Émettre", confirmation, issued view, net à payer in the list | `47cb1e6` |
| | | .2 Test what the items editor gives to the issue panel | `a17ae67` |
| S6-5 | Bug | .1 Bind the confirmation to the totals it was opened with | `78a6461` |
| S6-6 | Technical | .1 `docs/STATUS.md` as the single status file | `98ea019` |

---

## Sprint 7: Payments and status, P2e (Next)

Sprint goal: a facture can be paid and a devis cancelled, through functions only.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S7-0 | Preparation | .1 List the existing tests that insert payments or set a status by hand | To do |
| | | .2 Ask the accountant for the `paid_at` rules | Blocked (accountant) |
| | | .3 Short design note, approved before any code | To do |
| S7-1 | As a user, I record a payment on a sent facture | .1 Migration: `record_payment()` (SECURITY DEFINER, `search_path = ''`, grants) | To do |
| | | .2 Migration: revoke INSERT on `payments` from the API role | To do |
| | | .3 Adapt the tests listed in S7-0.1 | To do |
| | | .4 pgTAP: privileges, RLS isolation, refusals | To do |
| S7-2 | As a user, I cannot pay more than what is owed | .1 DF018: sum of payments compared with `net_a_payer` | To do |
| | | .2 Concurrency scenario: two payments at the same time | To do |
| S7-3 | As a user, my facture becomes `paid` when it is covered | .1 Automatic `paid` inside `record_payment()` | To do |
| | | .2 DF019: `paid` only when the payments cover the net à payer, for every role | To do |
| S7-4 | As a user, I cancel a sent devis | .1 `cancel_devis()` | To do |
| | | .2 DF021: refused when a facture was converted from it | To do |
| S7-5 | As a user, I do all this from the screen | .1 Payload builders and API functions, amounts as text | To do |
| | | .2 Payment form on the issued facture (`DecimalField`), list of payments, remaining amount | To do |
| | | .3 Confirmations bound to the displayed values | To do |
| | | .4 DF018 / DF019 / DF021 in `errorMessageKey()` and the French translations | To do |
| | | .5 Component tests; a `test:e2e-payments` script | To do |
| S7-6 | Closing | .1 `db:types`; codes in `CLAUDE.md`; manual check in a browser; `STATUS.md` | To do |

## Sprint 8: Devis to facture, and hardening (Planned)

Sprint goal: a devis becomes a facture in one click, and the existing screens are seen.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S8-0 | Preparation | .1 Decide: may one devis give several factures? | To do (product owner) |
| | | .2 Decide the length limits | To do (product owner) |
| S8-1 | As a user, I convert an issued devis into a draft facture | .1 Migration: `convert_devis_to_facture(p_devis_id)`, atomic, copies the lines | To do |
| | | .2 pgTAP and a concurrency scenario (two conversions at once) | To do |
| | | .3 Button with a bound confirmation; redirect to the new draft | To do |
| | | .4 Messages, component tests, e2e script | To do |
| S8-2 | As an organization, my free texts have a maximum length | .1 Check the existing rows against the limits | To do |
| | | .2 Migration: CHECKs; same limits in the Zod schemas | To do |
| | | .3 pgTAP and form tests | To do |
| S8-3 | As a user, the screens are usable on a phone and a desktop | .1 Screenshots of every P2c / P2d screen at both widths | To do |
| | | .2 Fix what the screenshots show | To do |
| S8-4 | Pending manual checks (section f of `STATUS.md`) | .1 Keyboard navigation in the issue confirmation | To do |
| | | .2 Each finalize refusal on the real screen (DF002 to DF008, DF022, DF023) | To do |
| | | .3 Facture draft of an organization without tax settings | To do |
| | | .4 Seller warnings disappear once the settings are filled | To do |
| | | .5 Settings, clients and auth screens re-checked | To do |
| S8-5 | Closing | .1 `db:types`, `CLAUDE.md`, `STATUS.md` | To do |

## Sprint 9: Credit notes, avoirs (Planned, not designed)

Sprint goal: a numbered facture can be corrected or cancelled.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S9-0 | Preparation | .1 Accountant: rules of an avoir, numbering series, effect on payments | Blocked (accountant) |
| | | .2 Design document, approved | To do |
| S9-1 | As a user, I issue an avoir on a facture | .1 Migration: schema, link to the corrected facture, guards | To do |
| | | .2 Issuing function with its own gapless numbering | To do |
| | | .3 pgTAP and concurrency scenarios | To do |
| | | .4 Screens: create, confirm, issued view | To do |
| S9-2 | As an organization, a confirmation covers the content, not only the total | .1 Revisit the DF009 limit (hash of the content) | To do |
| S9-3 | Closing | .1 Codes, translations, `db:types`, `STATUS.md` | To do |

## Sprint 10: Printable documents (Planned, not designed)

Sprint goal: a facture or a devis can be handed to a client.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S10-0 | Preparation | .1 Accountant: mandatory mentions, number format | Blocked (accountant) |
| | | .2 Decide: browser print or generated PDF; are line totals stored? | To do |
| S10-1 | As a user, I print or download an issued document | .1 Printable layout built from stored columns only | To do |
| | | .2 Print styles, page breaks for long documents | To do |
| | | .3 Tests: no recomputation of totals | To do |
| | | .4 Visual check on paper format | To do |
| S10-2 | Closing | .1 `STATUS.md` | To do |

## Sprint 11: Dashboard (Planned, not designed)

Sprint goal: a user sees the state of their activity when they sign in.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S11-0 | Preparation | .1 Decide what the dashboard shows | To do (product owner) |
| S11-1 | As a user, I see my unpaid and overdue factures | .1 Queries naming `organization_id`, amounts as text | To do |
| | | .2 "Overdue" derived from the due date, never stored | To do |
| | | .3 Screen, component tests | To do |
| S11-2 | Closing | .1 Manual check, `STATUS.md` | To do |

## Sprint 12: Team, invitations and roles (Planned)

Sprint goal: an owner brings a colleague into the organization, with limited rights.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S12-0 | Preparation | .1 Test scripts record the organizations they create and delete only those | To do |
| | | .2 Decide the roles per action | To do (product owner) |
| S12-1 | As an owner, I invite someone by e-mail | .1 Migration: invitations table, token, RLS | To do |
| | | .2 Function that creates the invitation; e-mail template | To do |
| S12-2 | As an invited user, I join the organization | .1 SECURITY DEFINER function that creates the membership | To do |
| | | .2 Acceptance page (button press, like `/auth/confirm`) | To do |
| | | .3 pgTAP, concurrency (double acceptance), e2e script | To do |
| S12-3 | As an owner, I decide who may finalize, pay and cancel | .1 Role checks inside the functions | To do |
| | | .2 Screens hide what a role cannot do (UX only) | To do |
| S12-4 | As an owner, I can hand over or close my organization | .1 Ownership transfer | To do |
| | | .2 Account deletion (to design) | To do |
| S12-5 | Closing | .1 Codes, translations, `db:types`, `STATUS.md` | To do |

## Sprint 13: Go live (Planned)

Sprint goal: the application runs on the internet, safely.

| ID | User story | Tasks | Status |
|---|---|---|---|
| S13-0 | Preparation | .1 Every `TODO(accountant)` of `STATUS.md` answered | Blocked (accountant) |
| | | .2 Deployment checklist written and approved | To do |
| | | .3 Replay of every migration from an empty database (`db:reset`, needs consent) | To do |
| S13-1 | As a user, I reach the application on the internet | .1 Hosted Supabase project configured like `supabase/config.toml` | To do (needs explicit agreement) |
| | | .2 Migrations applied; append-only from then on | To do |
| | | .3 Static host with the build | To do |
| S13-2 | As a user, my session is protected | .1 Strict CSP, `X-Content-Type-Options`, `Referrer-Policy` | To do |
| | | .2 Check: no secret key in the bundle or the env | To do |
| S13-3 | Closing | .1 Smoke test on the hosted project, `STATUS.md` | To do |

## Not in a sprint

| Item | Why |
|---|---|
| TTN / TEIF (El Fatoora) | Every external fact is unverified |
| Payment corrections by reversal entry | Not designed |
| `isNetworkError()` treats every `TypeError` as a network error | Small, to place in a sprint with spare room |
| `PGRST116` has no generic message | Same |
| Lists and drafts truncated at 1000 rows | Accepted limit for now |
