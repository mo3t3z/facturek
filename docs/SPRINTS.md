# Scrum sprints

Written on 2026-10-14 from `docs/STATUS.md` and the git history.

This file is a Scrum VIEW of the project: the same work as the checkpoints, grouped into
sprints. It does not replace `docs/STATUS.md`, which stays the one place that says where
the project is (test counts, open questions, risks). If the two disagree, `STATUS.md` wins.

Two honest warnings:

- **Sprints 1 to 6 are a regrouping made afterwards.** The project was built checkpoint by
  checkpoint between 2026-10-12 and 2026-10-14, not in timed sprints. The dates below are
  the real commit dates, not sprint dates.
- **Sprints 7 to 13 are a proposal.** Their order follows section b of `STATUS.md`. They
  carry no dates and no story points: no velocity has been measured yet. The size
  (S / M / L) is an estimate, to be corrected at each sprint planning.

## How Scrum maps onto this project

| Scrum | Here |
|---|---|
| Product backlog | Section b of `docs/STATUS.md` (remaining checkpoints, in order) |
| Sprint | One or more checkpoints with one goal |
| Sprint backlog item | A user story below, delivered as small commits on a `checkpoint/...` branch |
| Increment | The checkpoint branch merged into `main` with `--ff-only` |
| Sprint review | The manual check of the screens in a browser (section f of `STATUS.md`) |
| Sprint retrospective | The TODOs and rules added to `CLAUDE.md` after each checkpoint |
| Product owner input | The developer, plus the accountant for every `TODO(accountant)` |

Proposed sprint length: 1 week, to be adjusted after the first timed sprint.

### Definition of Done (every sprint)

A story is done only when all of this is true (rules from `CLAUDE.md`):

- `npm run test`, `npm run lint` and `npm run typecheck` pass on the tip of the branch,
  and `npm run test:coverage` when `src/lib/money` changed.
- Database work: a new migration file, RLS on every new table, pgTAP tests
  (`npm run test:db`), a concurrency scenario when two calls can race, and
  `npm run db:types` regenerated.
- A rule that protects issued data exists as a trigger or a CHECK, not only as RLS.
- Every new `DF0xx` code is in the table of `CLAUDE.md`, in `errorMessageKey()` and in
  `src/locales/fr/translation.json`.
- No hardcoded user-facing string, no hardcoded tax rate or amount.
- The screen was checked in a browser, and what was NOT checked is written down.
- `docs/STATUS.md` is updated before the merge. Nothing is pushed.

## Overview

| Sprint | Goal | Checkpoints | State |
|---|---|---|---|
| 1 | Multi-tenant foundation | scaffold, b-tenancy | Done (2026-10-12) |
| 2 | Documents in the database, numbered and frozen | c1, c2, c3 | Done (2026-10-12) |
| 3 | A user can sign up and sign in | d1, d2 | Done (2026-10-12) |
| 4 | Clients, money module, settings | p2-plan, P2a, P2b, P2c1 | Done (2026-10-13) |
| 5 | Draft documents with lines and a totals preview | P2c2, P2c3 | Done (2026-10-13) |
| 6 | Issue a document from the screen | P2d1, P2d2a, P2d2b, P2d3 | Done (2026-10-14) |
| 7 | Payments and status | P2e | Next |
| 8 | Devis to facture, and hardening | P2f, free-text CHECKs, pending manual checks | Planned |
| 9 | Credit notes (avoirs) | Avoir | Planned, not designed |
| 10 | Printable documents | PDF / print | Planned, not designed |
| 11 | Dashboard | Dashboard | Planned, not designed |
| 12 | Team: invitations and roles | Invitations | Planned |
| 13 | Go live | Deployment | Planned |
| Not scheduled | Electronic invoicing | TTN / TEIF (El Fatoora) | Blocked: facts unverified |

---

## Done sprints

### Sprint 1: Multi-tenant foundation

**Goal:** an empty application whose database already isolates one organization from
another.

- Project scaffold: Vite, React, TypeScript strict, Tailwind, Router, TanStack Query,
  i18n, Vitest, ESLint; local Supabase.
- As an organization, my data is invisible to the others: `organizations`,
  `organization_members`, RLS helpers `private.is_org_member` / `private.has_org_role`.
- As a member, I keep my clients and my tax settings per organization: `clients`,
  `tax_settings`.
- Memberships can never be inserted from the API; the last owner cannot be removed (DF020).

**Increment:** `e43c291`. pgTAP tests for schema security, isolation and roles.

### Sprint 2: Documents in the database, numbered and frozen

**Goal:** the database alone guarantees gapless numbers and immutable issued documents.

- Tables `documents`, `document_items`, `payments` with constraints and RLS (c1).
- As an organization, my factures and devis get a gapless number per type and year,
  assigned only by `finalize_document()`; tax values and identities are snapshotted (c2).
- As an organization, an issued document, its lines and its payments cannot be changed by
  any role: guard triggers, DF010 to DF017 (c3).
- A concurrency test with real parallel connections.

**Increment:** `48248cf`.

### Sprint 3: A user can sign up and sign in

**Goal:** a new user gets a working account without the frontend inserting any row.

- As a new user, my profile, organization, owner membership and empty tax settings are
  created at signup; `ensure_my_account()` repairs an incomplete account (d1).
- As a user, I can sign up, confirm my e-mail, log in and recover my password (d2).
- Security: confirmation only on a button press, `safeRedirectPath()`, error messages by
  code, anti-enumeration, refusal of a secret key in `.env`.
- `npm run test:e2e-auth`.

**Increment:** `8a1696d`.

### Sprint 4: Clients, money module, settings

**Goal:** everything a document needs before it can exist: a client, exact arithmetic,
and the tax settings.

- The Phase 2 plan and its decisions (docs).
- As a user, I list, search, create, edit and delete my clients, inside the app shell (P2a).
- Money as integer millimes with one rounding rule, 100 % covered, with vectors checked
  against Postgres (P2b).
- As an owner, I fill in my organization's identity and tax settings; an empty field is
  NULL, nothing is pre-filled (P2c1). `npm run test:e2e-settings`.

**Increment:** `ef2175f`.

### Sprint 5: Draft documents with lines and a totals preview

**Goal:** a user can prepare a complete devis or facture as a draft.

- As a user, I list my documents and create, edit and delete a draft (P2c2).
- As a user, I add, edit and remove lines one at a time and see a live preview of the
  totals, labelled as not saved (P2c3).
- `npm run test:e2e-documents`, `npm run test:e2e-items`.

**Increment:** `574c3f8`, then the `DecimalField` layout fix `d664661`.

### Sprint 6: Issue a document from the screen

**Goal:** a draft becomes a numbered, frozen document, for exactly the amount the user saw.

- The P2d design (docs).
- Totals are computed once in SQL (`private.compute_totals()`), stored when a document
  leaves `draft`; the timbre applies to factures only (P2d2a).
- `finalize_document(uuid, text)` refuses a total the user did not confirm: DF009, DF022,
  DF023 (P2d2b).
- As a user, I press "Émettre", confirm the totals, and then see a read-only issued
  document built only from stored columns; the list shows the net à payer (P2d3).

**Increment:** `2e83915`.

**Retrospective (the main lesson):** commit `78a6461`. Lines reloaded behind an open
confirmation, and a click issued a devis for an amount the user had not seen. Rule added:
every irreversible confirmation is bound to the values it displays.

**Carried over:** the layout has never been SEEN (page text only), and the other manual
checks of section f of `STATUS.md`. They are scheduled in sprint 8.

---

## Planned sprints

### Sprint 7: Payments and status (P2e). Size: L

**Goal:** a facture can be paid, and a devis can be cancelled, through functions only.

| Story | Acceptance |
|---|---|
| As a user, I record a payment on a sent facture | `record_payment` is the only API path; INSERT on `payments` is revoked; amounts compared with `net_a_payer` |
| As a user, I cannot record more than what is owed | DF018 (overpayment) |
| As a user, my facture becomes `paid` by itself when it is fully covered | Automatic status; DF019 (paid coverage) |
| As a user, I cancel a sent devis | `cancel_devis`; DF021 if a facture was converted from it |
| As a user, I see payments and the remaining amount on the issued facture | Confirmation bound to the displayed values |

**Before starting:** list the existing tests that insert payments or set a status by
hand; get the `paid_at` rules from the accountant (TODO(accountant)).

### Sprint 8: Devis to facture, and hardening (P2f + CHECKs + manual checks). Size: M

**Goal:** a devis becomes a facture in one click, and the screens built so far are
finally looked at.

| Story | Acceptance |
|---|---|
| As a user, I convert an issued devis into a draft facture | `convert_devis_to_facture(p_devis_id)`: atomic, copies the lines, sets `converted_from` |
| As an organization, my free-text columns have a maximum length | CHECKs (proposal: notes 2000, names 200, addresses 500); existing rows checked first |
| As a user, the screens are usable on a phone and on a desktop | Screenshots at both widths of every P2c / P2d screen |
| Pending manual checks are closed | Section f of `STATUS.md`: keyboard in the confirmation, each finalize refusal, facture draft without tax settings, seller warnings |

**To decide first:** may one devis be converted into several factures? The length limits.

### Sprint 9: Credit notes (avoirs). Size: L

**Goal:** a numbered facture can be corrected or cancelled, the only legal way.

- Sprint 9a (design, docs only): accounting rules, numbering series, link to the
  corrected facture, effect on payments. Needs the accountant.
- Sprint 9b (build): tables or columns, an issuing function, guards, the screens.
- Revisit here the known limit of DF009 (a hash of the content sent with the total).

**Blocked until:** the accountant answers. Nothing is designed.

### Sprint 10: Printable documents (PDF / print). Size: M

**Goal:** a facture or a devis can be handed to a client.

- As a user, I print or download an issued document.
- It shows only stored columns, like the issued view.

**To decide first:** the mandatory mentions (TODO(accountant)): matricule fiscal, address,
number format; whether per-line totals must then be stored.

### Sprint 11: Dashboard. Size: S to M

**Goal:** a user sees the state of their activity when they sign in.

- To define with the product owner: unpaid factures, overdue (derived, never stored),
  totals per period.

**To decide first:** what it should show. Depends on sprint 7 for the paid amounts.

### Sprint 12: Team, invitations and roles. Size: L

**Goal:** an owner can bring a colleague into the organization, with limited rights.

| Story | Acceptance |
|---|---|
| As an owner, I invite someone by e-mail | A token; nothing inserted from the API |
| As an invited user, I accept and join the organization | Membership created by a SECURITY DEFINER function |
| As an owner, I decide who may finalize, record payments and cancel | Roles per action (today any member may) |
| Ownership transfer and account deletion | The last owner can leave properly (DF020 today) |

**Before starting:** the e2e and concurrency scripts must record the organizations they
create and delete only those.

### Sprint 13: Go live (deployment). Size: M

**Goal:** the application runs on the internet, safely.

- A hosted Supabase project configured like `supabase/config.toml`; from then on
  migrations are append-only.
- A static host with a strict Content-Security-Policy, `X-Content-Type-Options` and
  `Referrer-Policy`.
- A deployment checklist (none exists yet), and a replay of every migration from an empty
  database.

**Blocked until:** every `TODO(accountant)` of `STATUS.md` is answered. Nothing real may
be issued before that. Every remote action needs the developer's explicit agreement.

### Not scheduled: TTN / TEIF (El Fatoora)

TTN fields writable after issue, and a TEIF export as a separate module. Every external
fact (the 2026 obligation, the portal, the certificates) is UNVERIFIED. It enters a sprint
only once the accountant and TTN have confirmed them.

## Backlog items without a sprint

- Payment corrections by reversal entry (payments are append-only, DF017).
- `isNetworkError()` treats every `TypeError` as a network error.
- `PGRST116` has no generic message.
- Lists and drafts are truncated at 1000 rows.
