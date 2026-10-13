# Tunisian Devis & Facture SaaS

Web app for Tunisian freelancers and small businesses to create quotes (devis) and
invoices (factures). Modular core: more modules (inventory, purchases, reports) come
later. The MVP is invoicing only.

## Stack

React + Vite (SPA) + TypeScript strict + Tailwind + React Router + TanStack Query +
React Hook Form + Zod + Supabase (Auth, Postgres, RLS) + Vitest + ESLint.
Package manager: npm. Supabase CLI is a devDependency (`npx supabase ...`).

## Commands

- `npm run dev` – Vite dev server
- `npm run lint` / `npm run typecheck` / `npm run test` – must all pass before a step is done
- `npm run db:start` / `npm run db:stop` – local Supabase (needs Docker running)
- `npm run db:reset` – re-apply all migrations to the LOCAL database
- `npm run test:db` – pgTAP tests in `supabase/tests`
- `npm run test:concurrency` – many real connections call `finalize_document()` at once
  (local database only; pgTAP cannot test this because it runs in one session)
- `npm run test:e2e-auth` – real signup, email confirmation, login, `ensure_my_account`
  and password recovery through the LOCAL Auth/REST APIs and Mailpit (never prints keys)
- `npm run test:e2e-settings` – two throwaway users through the LOCAL Auth/REST APIs:
  numerics as strings in and out, and RLS isolation of the settings (never prints keys)
- `npm run test:e2e-documents` – two throwaway users through the LOCAL Auth/REST APIs:
  draft insert/list/update/delete, RLS isolation, what `finalize_document` refuses over
  REST (one argument: PGRST202; wrong, null or numeric expected total: DF009), and what an
  issued document refuses (Node `--experimental-strip-types`: it uses `computeTotals`)
- `npm run test:e2e-items` – lines of a document through the LOCAL Auth/REST APIs: numerics
  as text both ways, RLS isolation, what an issued document refuses, and `computeTotals`
  compared with Postgres on the stored lines (Node `--experimental-strip-types`, no dependency)
- `npm run db:types` – regenerate `src/types/database.types.ts`
- `npm run test:coverage` – money module tests with coverage; fails below 100 % of
  statements, branches, functions and lines of `src/lib/money`
- `npm run money:vectors` – regenerate the random vectors of `src/lib/money/vectors.json`
  with the LOCAL Postgres as the oracle (read-only SELECT; fixed seed, same output every
  time). The oracle is `private.compute_totals()`, the function that writes the totals of
  an issued document, not a copy of its formula. It also checks the hand-written vectors
  against Postgres and fails if one differs (it never rewrites them).

## Structure

- `src/app/` router, providers, route guards
- `src/app/AppLayout.tsx` shell of the authenticated area (navigation, sign-out)
- `src/components/` UI shared by several features (form controls, button styles)
- `src/features/<module>/` one folder per feature module (auth, organizations, ...)
- `src/lib/` supabase client, env validation, shared helpers
- `src/locales/<lang>/` translation JSON
- `supabase/migrations/` SQL migrations, `supabase/tests/` pgTAP tests

## Rules

### Security (this is a SPA: RLS is the only real barrier)
- RLS enabled on EVERY table. Policies are based on organization membership via
  `private.is_org_member(org_id)` / `private.has_org_role(org_id, roles)`.
- Every business table has `organization_id`. Children (items, payments) are tied to
  their parent document's org by a composite foreign key.
- Frontend uses the anon key only. The service role key never appears in client code,
  committed env files, or the bundle. `VITE_` vars: public URL and anon key only.
- NEVER expose the service role key to any client: not in the SPA, not in a `VITE_`
  variable, not in a mobile app, not in a committed file. It bypasses RLS entirely.
- Route guards are UX only. Never rely on them for protection.
- SECURITY DEFINER functions: `set search_path = ''`, fully qualified names,
  `REVOKE ... FROM public`, `GRANT EXECUTE` only to the roles that need it.
- Never commit secrets. Only `.env.example` is committed.

### Data
- Money is `numeric(12,3)` (TND has 3 decimals). Never floats.
- In TypeScript, money is an integer number of millimes (`Millimes`), quantities and rates
  are integers x 1000 (`QtyMilli`, `RateMilli`). Every calculation, parse and format goes
  through `src/lib/money/money.ts`: a pure module (no import), bigint inside, no
  `parseFloat` / `toFixed` / `Math.round` / `Intl`. Rounding rule: line total rounded
  half-up per line, TVA rounded half-up ONCE per rate. TODO(accountant): verify it.
- The rounding rule exists ONCE in SQL: `private.compute_totals(private.document_line[],
  numeric)` (immutable, reads no table, executable by no API role). Never write
  `round(` on an amount anywhere else in a migration, a function or a script: call it.
  `008_totals.test.sql` fails if a second function of the application rounds.
- Names of the totals, in SQL (`documents`) and in TypeScript (`Totals`), same meaning on
  both sides. TODO(accountant):
  `total_ht` / `totalHT`; `total_tva` / `totalTVA`; `total_ttc` / `totalTTC` = HT + TVA,
  NEVER the timbre; `timbre_fiscal` / `timbre` = the droit de timbre charged (NULL = none);
  `net_a_payer` / `netAPayer` = total TTC + timbre, what the client owes;
  `tva_breakdown` = per-rate table `[{"rate","base","tva"}]` whose values are TEXT with 3
  decimals, never JSON numbers. The retenue à la source is in none of them.
- A draft stores NO total (CHECK). The five totals columns are written when a document
  leaves `draft`, by the trigger `set_document_totals`, for every role: whatever the
  caller sends is overwritten from the lines. They are then frozen like every other
  column of an issued document. The API role can read them and write none.
- The timbre fiscal is charged on factures only: `finalize_document()` snapshots it only
  for a facture, and a CHECK forbids it on a devis for every role. An organization cannot
  enable the timbre without an amount (CHECK on `tax_settings`).
- `document_items.description` is at most 500 characters (CHECK), like the screen.
- Money, quantities and rates are read from PostgREST as text (`total_ttc::text`) and
  parsed with `fromDbNumeric` / `fromDbQuantity` / `fromDbRate`; they are sent back with
  `toDbNumeric`. A JSON number would be a float.
- Writing a numeric column goes through `dbNumeric()` (`src/lib/dbNumeric.ts`), the one
  place where the generated `number` type is bridged; never `as any`, never `select('*')`.
- Amounts and rates are typed in `<DecimalField>` (`src/components`), which shows the value
  as it was understood once the field is left. An empty field is NULL, never zero, and no
  tax value is ever pre-filled.
- An UPDATE filtered out by RLS is not an error for PostgREST (0 rows). Every update ends
  with `.select(...).single()` so that it fails with `PGRST116`, which the screen maps to a
  French message through the second argument of `errorMessageKey()`.
- Tax rates and amounts are NEVER hardcoded in code or migrations. They live in
  `tax_settings` and must be verified with an accountant / official source.
- Document numbers are assigned only by `public.finalize_document()` in Postgres
  (gapless per org/type/year), never in the frontend. Drafts have no number.
- `finalize_document(p_document_id, p_expected_net_a_payer text)`: the second argument is
  REQUIRED (no default, no overload; the one-argument function was dropped). It is the net
  à payer the user confirmed, as TEXT in the exact form Postgres prints a `numeric(12,3)`
  (`"1190.600"`, from `toDbNumeric`). Postgres recomputes the totals and compares the two
  TEXTS; the caller's text is never cast to a number, so `"1190.6"`, `"1e3"`, a JSON
  number, NULL or garbage are all refused (DF009). Every refusal of the totals (DF023,
  DF022, DF009, in that order) happens before the counter is touched: no number is
  consumed. The frontend builds the arguments in `finalizePayload()` only.
- Finalizing snapshots tax values plus seller and buyer identity onto the document.
  The snapshot columns, `status`, `number` and `year` are not writable by the API role.
- `document_counters` is only touched by `finalize_document()`: RLS on, no policy, no
  privilege for `anon` / `authenticated`.
- Non-draft documents are immutable at the DB level (triggers). Corrections will be
  credit notes (avoirs) in a later phase. "Overdue" is derived, never stored.
- Two layers, on purpose. RLS policies and column privileges bind the API role only.
  Triggers and CHECK constraints bind EVERY role (service role, SQL editor). A rule that
  protects issued documents, items or payments must exist as a trigger or a constraint.
- A guard trigger that looks at a parent document locks it with `SELECT ... FOR SHARE`
  (this is what closes the race with `finalize_document()`), and calls
  `private.reject_non_member()` first on INSERT: BEFORE triggers run before RLS, so
  without it a trigger error could reveal the state of another organization's document.
  A signed-in non-member always gets `42501 permission denied` from these triggers.

- Memberships (`organization_members`) are never inserted from the API: no INSERT
  privilege, no INSERT policy. Only SECURITY DEFINER functions create them.

### Accounts (signup and repair)
An account = profile + one organization + owner membership + empty `tax_settings`.
The frontend never inserts these rows. `private.provision_account()` creates them and is
reached only through two SECURITY DEFINER functions:

- `private.handle_new_user()`: AFTER INSERT trigger on `auth.users`. Profile `full_name`
  comes from `raw_user_meta_data->>'full_name'` (trimmed, max 100 chars, else NULL); the
  organization takes the same name, or the placeholder `'Mon activité'`. `tax_settings`
  is created empty (every rate and amount NULL, both switches false).
  It NEVER makes a signup fail: any error is caught and logged as a WARNING with its
  SQLSTATE. Consequence: a user can exist without a profile and without an organization.
- `public.ensure_my_account()`: RPC for `authenticated` only, no parameter, acts only on
  `auth.uid()`. Creates the account if the caller has no membership at all, otherwise
  does nothing; returns the organization id of the caller's first membership. It raises
  on failure (it does not swallow errors). The frontend must call it right after login
  and use the returned id as the current organization.

Provisioning is idempotent and serialized per user with `pg_advisory_xact_lock`, so
repeated or simultaneous calls never create a second organization.
In tests, `tests.signup()` performs a signup exactly as Supabase Auth does (one INSERT
into `auth.users`).

### Custom SQLSTATE codes
Raised by our triggers/functions so tests and the frontend can tell a business-rule
rejection from an RLS/privilege rejection (`42501`). Add a row here whenever a new code is
introduced.

| Code  | Meaning | Where raised |
|-------|---------|--------------|
| DF000 | Not authenticated: the call carries no user id | `public.finalize_document()`, `public.ensure_my_account()` |
| DF001 | Document not found. Deliberately the same error for an id that does not exist and for a document of another organization | `public.finalize_document()` |
| DF002 | Document is not a draft (already finalized) | `public.finalize_document()` |
| DF003 | Document has no client | `public.finalize_document()` |
| DF004 | Document has no items | `public.finalize_document()` |
| DF005 | Issue date is in the future (today = Africa/Tunis) | `public.finalize_document()` |
| DF006 | Issue date is earlier than the previous numbered document of the same organization, type and year | `public.finalize_document()` |
| DF007 | Facture while `timbre_enabled` is true but `timbre_fiscal` has no amount. Second line of defence: the CHECK `tax_settings_timbre_enabled_has_amount` already makes that state impossible (`23514`) | `public.finalize_document()` |
| DF008 | Due date is before the issue date | `public.finalize_document()` |
| DF009 | The expected total differs from the computed total: the text sent as `p_expected_net_a_payer` is not the net à payer Postgres computed (the document or the settings changed since the screen showed it, or the value is not text with 3 decimals) | `public.finalize_document()` |
| DF010 | A non-draft document cannot be deleted | `private.guard_documents()` (trigger on `documents`) |
| DF011 | A non-draft document is frozen: a column other than `status` / `updated_at` was changed (the message names the columns) | `private.guard_documents()` |
| DF012 | Status transition not allowed. Allowed: draft → sent; facture sent → paid; devis sent → cancelled | `private.guard_documents()` |
| DF013 | `converted_from` rule violated: only a facture, only from a devis that is neither draft nor cancelled, never from itself | `private.guard_document_conversion()` (trigger on `documents`) |
| DF014 | The items of a non-draft document cannot be inserted, updated or deleted | `private.guard_document_items()` (trigger on `document_items`) |
| DF015 | An item cannot be moved to another document or organization | `private.guard_document_items()` |
| DF016 | A payment can only be recorded on a facture whose status is `sent` | `private.guard_payments()` (trigger on `payments`) |
| DF017 | Payments are append-only: no UPDATE, no DELETE, for any role | `private.guard_payments()` |
| DF020 | Membership rule violated: the last owner cannot be removed or demoted; `organization_id` / `user_id` of a membership cannot change | `private.guard_organization_members()` (trigger on `organization_members`) |
| DF022 | The total is zero: `total_ttc` (HT + TVA) is 0, with or without a timbre. TODO(accountant) | `public.finalize_document()` |
| DF023 | The total exceeds the maximum: the net à payer does not fit `numeric(12,3)` | `public.finalize_document()` |
| DF040 | `organization_id` of a row cannot be changed | `private.prevent_organization_change()` (trigger on `clients`) |

### Generated files
- `src/types/database.types.ts` is GENERATED by `npm run db:types` from the local
  database. Never edit it by hand; regenerate it after every migration. It is excluded
  from ESLint. (Prettier is not installed; if it is added, ignore this file there too.)

### TODO (later phases, not started)
- P2d (design and decisions in `docs/p2d-design.md`). Done in P2d2a: the two CHECKs, the
  stored totals and their trigger, `private.compute_totals()`, timbre on factures only.
  Done in P2d2b: `finalize_document(uuid, text)`, DF009 / DF022 / DF023, and the plumbing
  `finalizeDocument()` / `finalizePayload()` (no screen uses them yet).
  - P2d3: the issue button with its confirmation, and the read-only issued view. The
    button must be disabled while a line form holds unsaved input: the preview counts the
    pending line, Postgres does not, and the user would get a DF009 they cannot understand.
  - A document issued by hand by a privileged role (not through `finalize_document`) whose
    totals do not fit `numeric(12,3)` still fails with a raw `22003` from the trigger.
  - A full replay of the migrations from an empty database (`db:reset`) has not been run
    since P2d2a; it wipes the local data and needs the developer's explicit consent.
  - TODO(accountant): `finalize_document()` requires `seller_name` only. A facture without
    the seller's matricule fiscal or address may not be legally valid. Nothing is refused
    for now; the confirmation screen of P2d3 must WARN when a seller field is missing.
  - TODO(accountant): is a facture with a total of zero ever legitimate (P2d2b refuses it)?
  - Separate small checkpoint: length CHECKs on the other free-text columns (proposal:
    notes 2000, names 200, addresses 500); none has a limit in the database today.
  - Reserved codes: DF018 overpayment, DF019 paid coverage, DF021 cancel a devis that has a
    converted facture.
- Later: avoir (credit note) type; TTN fields (`ttn_reference`, `ttn_status`, signed XML)
  as columns writable after issue, excluded from what `guard_documents` freezes; TEIF
  export as a separate module. The external facts (El Fatoora from 2026, TTN portal,
  TunTrust certificates) are unverified, pending the accountant and TTN.
- Possible UX bug, not reproduced yet: the `DecimalField` reading appearing on blur may
  shift the layout and swallow the first click on the submit button. Reproduce before
  changing anything.
- Before the invitation flow exists, the e2e/concurrency scripts must record the
  organization ids they create and delete only those (today they find organizations
  through memberships).
- Invitation flow: tokens, accepted by the invited user, membership created by a
  SECURITY DEFINER function. Until then an organization has only its signup owner.
- Payment corrections: payments cannot be updated or deleted by any role (DF017). A
  mistake must be corrected with a reversal entry (design and build later).
- Credit notes (avoirs): the only way to correct or cancel a numbered facture. Until
  they exist a numbered facture cannot be cancelled at all.
- Status changes after `sent` have no API path yet (the API role cannot write `status`).
  Phase 2: `sent -> paid` for a facture and cancelling a devis need SECURITY DEFINER
  functions, tied to the document totals and the sum of its payments (a facture is
  "paid" when its payments cover its total, not when someone says so).
- A devis can currently be converted into several factures (`converted_from` has no
  uniqueness rule). Decide in phase 2 whether that is wanted.
- Have an accountant check the status transition map and the two date rules of
  `finalize_document()`.
- Ownership transfer and account deletion: today the last owner cannot leave or be
  deleted (the DF020 trigger also blocks the `auth.users` cascade).

### Auth and the browser (SPA trade-offs)
- Email links go to OUR page: `/auth/confirm?token_hash=...&type=email|recovery` (templates
  in `supabase/templates`). The page calls `supabase.auth.verifyOtp()` only when the user
  presses a button, so a mail scanner that opens the link cannot spend the token.
- supabase-js owns the session (stores and refreshes it). App code never reads, writes or
  copies a token, never uses `localStorage` / `sessionStorage` / cookies itself, and never
  logs to the console. `src/test/sourceRules.test.ts` enforces this.
- XSS trade-off, accepted for now: a SPA keeps its session where JavaScript can read it
  (supabase-js uses localStorage). Any XSS could therefore steal the session, and RLS
  would not help because the attacker would BE the user. Defences today: React escapes
  all text, `dangerouslySetInnerHTML` is banned, user text (names) is rendered as text only.
- TODO at deployment: a strict Content-Security-Policy (no inline script, `connect-src`
  limited to the Supabase project, `frame-ancestors 'none'`), plus `X-Content-Type-Options`
  and `Referrer-Policy`, set by the static host (Vercel / Netlify headers).
- Any "where to go next" value from the URL goes through `safeRedirectPath()`
  (`src/lib/safeRedirect.ts`): same-origin relative paths only.
- Every backend error shown to the user goes through `errorMessageKey()`
  (`src/lib/errors.ts`): an i18n key chosen from the error CODE, never the raw message.
  New DF0xx codes must be added there and in `src/locales/fr/translation.json`.
  A screen that knows what a code means for the action it just ran passes its own key as
  the second argument (deleting a client: `{ '23503': 'clients.errors.inUse' }`).
- Anti-enumeration: login failures share one message; signup and forgot-password show the
  same screen whether or not the address is registered.
- `.env` may only contain `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The app
  refuses to start if the key is a secret (`sb_secret_...`) or a `service_role` JWT.
- Password policy: minimum 10 characters, no composition rule (`supabase/config.toml`
  and `PASSWORD_MIN_LENGTH` in `src/features/auth/schemas.ts` must stay in sync).
- The hosted project must be configured like `supabase/config.toml` (site URL, email
  confirmation, password length, both email templates). Nothing remote exists yet.

### Database workflow
- Local only. Never touch a remote/production database; ask before any remote action.
- Schema changes go through new migration files, never by editing the DB by hand.
- Once any remote database exists, migrations are append-only: never edit an applied
  migration, always add a new one.
- No destructive operations without the user's confirmation.

### Frontend
- UI is French first, i18n-ready for Arabic (react-i18next). No hardcoded user-facing
  strings in components.
- Forms: React Hook Form + Zod. Server state: TanStack Query.
- Dates of a document are calendar days kept as plain `YYYY-MM-DD` text from the input to
  the database and back (`src/features/documents/dates.ts`). Never `new Date(` /
  `toISOString` there: UTC+1 would shift the day. `sourceRules.test.ts` enforces it.
- What the frontend writes on a document is built in `src/features/documents/payload.ts`
  only (insert: organization_id, type, client_id, issue_date, due_date, notes; update:
  the last four). A test checks the exact keys; status, number and year are never sent.
  The arguments of `finalize_document` are built there too (`finalizePayload()`: exactly
  two keys, the expected total as a string); `finalize.test.ts` proves it is never a number.
- Lines of a document are saved one at a time (one row per request,
  `src/features/documents/itemsApi.ts`); every write names `organization_id` and
  `document_id`. `readItem()` (`itemSchema.ts`) is the single definition of a complete line.
- The totals on a draft are a PREVIEW (`preview.ts` + `TotalsPreview`): every amount comes
  from `computeTotals()`, nothing is written, and it is labelled "Aperçu, non enregistré".
  Rows, in this order: Total HT, TVA, Total TTC, Droit de timbre (only when one applies:
  a facture of an organization that charges it), Net à payer.
  No `parseFloat` / `Number(` / `toFixed` / `Math.round` in `src/features/documents`.
  The stored totals of an issued document are not displayed yet (P2d3).
- Screens that need the organization are routed under `<RequireOrganization>` and read it
  with `useOrganization()`. Every query names `organization_id` explicitly, on top of RLS.
- Text typed by the user never goes into a PostgREST filter string (the clients search
  runs in the browser on the loaded list).
- No unnecessary dependencies.

### Workflow
- Read existing code before changing it and follow project conventions.
- After changes run lint, typecheck and tests and report the REAL output. Never claim
  something passed if it did not run, and never claim manual testing without evidence.
- Git: small local commits on one branch per step. Never push.
- Never merge into `main` unless `npm run test`, `npm run lint` and `npm run typecheck`
  (and `npm run test:coverage` when `src/lib/money` changed) pass on the TIP of the branch
  being merged. Run them right before the merge, and stop if one fails: `main` must never
  be red, even for one commit. Merges are `--ff-only`.
- Build only the current phase. Do not start the next phase without approval.
- The developer is a junior: explain key decisions briefly (why, trade-offs).
