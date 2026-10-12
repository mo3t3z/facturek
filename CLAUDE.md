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
- `npm run db:types` – regenerate `src/types/database.types.ts`

## Structure

- `src/app/` router, providers, route guards
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
- Route guards are UX only. Never rely on them for protection.
- SECURITY DEFINER functions: `set search_path = ''`, fully qualified names,
  `REVOKE ... FROM public`, `GRANT EXECUTE` only to the roles that need it.
- Never commit secrets. Only `.env.example` is committed.

### Data
- Money is `numeric(12,3)` (TND has 3 decimals). Never floats.
- Tax rates and amounts are NEVER hardcoded in code or migrations. They live in
  `tax_settings` and must be verified with an accountant / official source.
- Document numbers are assigned only by `public.finalize_document()` in Postgres
  (gapless per org/type/year), never in the frontend. Drafts have no number.
- Finalizing snapshots tax values plus seller and buyer identity onto the document.
- Non-draft documents are immutable at the DB level (triggers). Corrections will be
  credit notes (avoirs) in a later phase. "Overdue" is derived, never stored.

### Database workflow
- Local only. Never touch a remote/production database; ask before any remote action.
- Schema changes go through new migration files, never by editing the DB by hand.
- No destructive operations without the user's confirmation.

### Frontend
- UI is French first, i18n-ready for Arabic (react-i18next). No hardcoded user-facing
  strings in components.
- Forms: React Hook Form + Zod. Server state: TanStack Query.
- No unnecessary dependencies.

### Workflow
- Read existing code before changing it and follow project conventions.
- After changes run lint, typecheck and tests and report the REAL output. Never claim
  something passed if it did not run, and never claim manual testing without evidence.
- Git: small local commits on one branch per step. Never push.
- Build only the current phase. Do not start the next phase without approval.
- The developer is a junior: explain key decisions briefly (why, trade-offs).
