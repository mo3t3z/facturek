# Deployment checklist

Written 2026-10-15. Nothing is deployed and no remote database exists. This file is the
checklist for the FIRST deployment; every remote step needs the developer's explicit
agreement at the moment it is done (`CLAUDE.md`, "Database workflow").

## 0. Gate: do not deploy for real use before this

- [ ] Every `TODO(accountant)` question of `docs/STATUS.md` (section d) is answered, and the
      questions C1 to C12 of `docs/avoir-print-design.md`. Nothing real may be issued before.
- [ ] The TTN / El Fatoora obligation is known (STATUS, section d).
- [ ] `npm run test`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` pass on
      the commit that is deployed.
- [ ] Every migration has been replayed on an EMPTY database (section 2) and `npm run test:db`
      passes on it.

A demo deployment without real users may come earlier, but the accountant gate still applies
to any document issued for a real client.

## 1. Hosted Supabase project

Configured like `supabase/config.toml` (the local reference). In the dashboard:

| Setting | Value | Local source |
|---|---|---|
| Site URL | the app's public URL (https) | `[auth] site_url` |
| Redirect URLs | only the app's `/auth/confirm` | `additional_redirect_urls` |
| Email signup | on; **confirm email: on** | `[auth.email] enable_signup`, `enable_confirmations` |
| Double confirm email changes | on | `double_confirm_changes` |
| Minimum password length | 10, no composition rule | `minimum_password_length`, `PASSWORD_MIN_LENGTH` |
| Phone signup | off | `[auth.sms] enable_signup = false` |
| Email templates | confirmation and recovery from `supabase/templates` (links to OUR `/auth/confirm` page) | `[auth.email.template.*]` |
| API max rows | 1000 (the screens warn at that limit) | `[api] max_rows` |
| JWT expiry | 3600 s | `jwt_expiry` |
| SMTP | a real sender (the built-in one is rate-limited and for tests) | none locally (Mailpit) |

- [ ] Region chosen (closest to Tunisia that the plan allows).
- [ ] Database password stored in a password manager, NEVER in the repository.
- [ ] Backups: the plan's daily backups checked; point-in-time recovery if available.

## 2. Database

- [ ] Replay every migration on an EMPTY local database first (`npm run db:reset`; it wipes
      the local data and needs the developer's consent), then `npm run test:db`,
      `npm run test:concurrency` and the e2e scripts.
- [ ] Link the project (`npx supabase link`), then `npx supabase db push`. From that moment
      migrations are APPEND-ONLY: never edit one that was pushed.
- [ ] After the push, check on the hosted database: RLS on every table, no policy and no
      privilege on `document_counters`, no INSERT on `payments` for `authenticated`, the
      functions executable only by `authenticated` (the checks of `001_schema_security`).
      pgTAP is not run against the hosted database (it creates test users).
- [ ] The service role key stays in the dashboard. It is never copied into the app, a
      `VITE_` variable, the host's settings for the front end, or a file.

### Order of the roles work (R1 before any multi-user feature)

- [ ] The R1 protections (migration `20261015180001_roles_per_action.sql`: DF026 in
      `finalize_document`, `record_payment`, `cancel_devis`) are applied to the hosted
      database BEFORE any feature that lets a second person into an organization
      (invitations, R2/R3) is exposed. Pushing all migrations in order guarantees it; never
      deploy an invitation feature on a database that lacks R1.
- [ ] R-10 (exactly one owner) is implemented and pushed before ownership can be shared or
      transferred (R5).
- [ ] Invitation tokens never reach a log: on the hosted project, statement and parameter
      logging must not include the parameters of `accept_invitation` (keep
      `log_parameter_max_length_on_error = 0`, no `log_statement = all`, no pgaudit on it).

## 3. Front end (static host)

- [ ] Host chosen. Any static host works (Netlify, Cloudflare Pages, Vercel...). The SPA
      needs one rewrite: every path that is not a file serves `index.html`.
- [ ] Build environment variables: `VITE_SUPABASE_URL` (https URL of the project) and
      `VITE_SUPABASE_ANON_KEY` ONLY. The app refuses to start with a secret key
      (`sb_secret_...`) or a `service_role` JWT.
- [ ] Security headers. `npm run build` writes them into `dist/_headers` from
      `src/lib/securityHeaders.ts` (format of Netlify and Cloudflare Pages). On another host,
      copy the SAME four headers into its own configuration (`vercel.json` "headers").
      `connect-src` is computed from `VITE_SUPABASE_URL`: rebuild if the project changes.
- [ ] Check them on the deployed site: `Content-Security-Policy`, `X-Content-Type-Options`,
      `Referrer-Policy: no-referrer`, `Permissions-Policy` in the response headers, and no
      CSP violation in the browser console on login, a draft, issuing, a payment.
- [ ] HTTPS only (the host's default), HSTS if the host offers it.

## 4. Smoke test on the deployed site

- [ ] Sign up with a throwaway address, receive the e-mail, confirm through the button,
      log in, recover the password.
- [ ] Settings, a client, a devis issued and converted, a facture issued, a payment, a
      devis cancelled: each once, at desktop and phone width.
- [ ] A second account cannot see the first one's data.
- [ ] Remove the throwaway accounts afterwards (they own issued documents: this needs the
      same care as the cleanup of the local scripts).

## What is verified locally today (2026-10-15)

- `npm run preview` serves the built app with the same headers. Checked in a browser: login,
  an issued facture with its payments, styles applied, calls to Supabase allowed, no CSP
  violation in the console; an injected inline script and a call to another domain are
  blocked (`script-src-elem`, `connect-src` violations).
- Not verified: the replay of every migration on an empty database (needs consent), any
  hosted step (nothing remote exists).
