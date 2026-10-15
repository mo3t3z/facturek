# Design: roles per action and invitations (Sprint 12, design only)

Written 2026-10-15 on `checkpoint/roles-design` from `main` (`d3794e0`).

**Approved 2026-10-15:** R-1 to R-9 as written; R-10 with the correction below (never zero
owner). GO for R1 only. R2 to R5 need a separate approval. No remote database, no
deployment, no change to the legal invoicing rules without verification.

Sources: catalog queries on the local database (rebuilt from empty the same day),
`CLAUDE.md`, `docs/STATUS.md`, `src/`.

---

## Part 1. Facts

### 1. Roles today

`public.org_role` = `{owner, admin, member}`. Every account starts as the `owner` of its
own organization (signup trigger). Nobody can join another organization: memberships are
never inserted from the API (no INSERT privilege, no policy), and no invitation exists.

### 2. Who may do what today (enforced by Postgres)

| Action | Rule today | Where |
|---|---|---|
| Read everything of the organization | any member | `*_select` policies (`is_org_member`) |
| Clients: create, edit, delete | any member | `clients_*` policies |
| Drafts and their lines: create, edit, delete | any member | `documents_*`, `document_items_*` policies |
| Issue a document (`finalize_document`) | **any member** | function: `is_org_member` only |
| Record a payment (`record_payment`) | **any member** | function: `is_org_member` only |
| Cancel a devis (`cancel_devis`) | **any member** | function: `is_org_member` only |
| Convert a devis (`convert_devis_to_facture`) | **any member** | function: `is_org_member` only |
| Organization identity (name, matricule, address...) | owner | `organizations_update` |
| Tax settings | owner, admin | `tax_settings_update` |
| Change a member's role | owner | `organization_members_update` |
| Remove a member | owner: anyone; admin: plain members; anyone: themselves | `organization_members_delete` |
| Last owner removed or demoted | refused for every role (DF020) | `guard_organization_members` |

### 3. The frontend knows nothing about roles

No screen reads the caller's role. A member who opens Paramètres sees the forms; saving
fails with PGRST116 (RLS answers "0 rows"), and the screen says "nothing was saved".
`ensure_my_account()` returns the FIRST membership and the app uses it as the current
organization: there is no way to choose between two organizations.

---

## Part 2. Proposals

### A. Roles per action

The rule of thumb: a member PREPARES, an owner or admin COMMITS (anything numbered,
frozen or about money).

| Action | owner | admin | member |
|---|---|---|---|
| Read everything | yes | yes | yes |
| Clients, drafts, lines | yes | yes | yes |
| Convert a devis into a draft facture | yes | yes | yes (it only creates a draft) |
| Issue a document | yes | yes | **no** |
| Record a payment | yes | yes | **no** |
| Cancel a devis | yes | yes | **no** |
| Tax settings | yes | yes | no (unchanged) |
| Organization identity | yes | no | no (unchanged) |
| Invite / remove members | yes (any role but owner) | members only | no |
| Change roles, transfer ownership | yes | no | no |

**How it is enforced (two layers, as everywhere):**
- Postgres: `finalize_document`, `record_payment` and `cancel_devis` check
  `private.has_org_role(org, ['owner','admin'])` AFTER the membership check, and refuse a
  member with a new code **DF026** ("your role does not allow this action"). The order
  keeps DF001 for a document of another organization (no information leaks).
- Screens (UX only): a `useMyRole()` query reads the caller's row of
  `organization_members`; the buttons a member cannot use are replaced by one sentence
  ("Seul un propriétaire ou un administrateur peut émettre ce document."). The settings
  forms become read-only for whoever cannot save them. Never relied on for protection.

### B. Invitations

Two ways to deliver an invitation:

| | 1. A link the inviter copies and sends | 2. An e-mail sent by the app |
|---|---|---|
| Server part | none: two SQL functions | an Edge Function (Supabase's invite API needs the service role key, which must stay on a server) |
| Work | small | an Edge Function to write, secure, deploy and test |
| Risk | the inviter must send the link | a new server component that holds the service role key |

**Proposal: option 1 first**, option 2 later if needed. Design of option 1:

- Table `organization_invitations`: `id`, `organization_id`, `email` (lower case), `role`
  (`admin` or `member`, never `owner`), `token_hash` (SHA-256 of the token: the raw token
  is never stored), `invited_by`, `created_at`, `expires_at` (7 days), `accepted_at`,
  `revoked_at`. RLS on; owners and admins of the organization can READ its invitations;
  nobody inserts, updates or deletes from the API.
- `public.create_invitation(p_organization_id, p_email, p_role)` (owner; admin for
  `member` only): returns the raw token ONCE; the screen builds the link
  `/invitation?token=...` and shows it to copy. One pending invitation per address and
  organization.
- `public.revoke_invitation(p_invitation_id)`.
- `public.accept_invitation(p_token)` (authenticated): the token must match, not be
  expired, revoked or used, and the invitation's e-mail must be the caller's CONFIRMED
  e-mail. Then, in one transaction: the membership is created (the only other place that
  creates memberships, next to signup), the invitation is marked accepted. Every failure
  gives the same error (no way to probe tokens or addresses).
- The invitation page works like `/auth/confirm`: nothing is accepted until the user
  presses a button (a mail scanner that opens the link spends nothing). A visitor who is
  not signed in is sent to signup or login first, through `safeRedirectPath()`.
- New codes: DF027 invitation invalid (one code for every reason), DF028 address already
  a member.

### C. Several organizations per user

Accepting an invitation gives the user a SECOND organization (their own one from signup
stays). Today the app always takes the first membership. Proposal:

- The shell shows the current organization's name and, when there are several, a switch
  (a select in the header) that lists the user's organizations.
- The choice is remembered per browser as a convenience only (if it is missing or no
  longer valid, the first membership is used). It changes no right: every query still
  names `organization_id`, and RLS still decides.
- The switch reloads every query of the old organization (all keys start with the
  organization id, so they do not mix).

Note: `CLAUDE.md` forbids `localStorage` in app code (only supabase-js uses it). Keeping
the choice would need a narrow exception (a non-sensitive organization id) or a column
`profiles.current_organization_id` written through a function. **Proposal: the column**,
so the rule stays unbroken.

### D. Leaving, removing, transferring

- Remove a member (owner; admin for members): already allowed by RLS; gets a screen.
- Leave an organization: allowed except for the last owner (DF020 today).
- Transfer ownership: `public.transfer_ownership(p_organization_id, p_user_id)` (owner):
  in one transaction the other member becomes owner, the caller becomes admin. Last-owner
  rule kept.
- Account deletion: NOT in this sprint. An account that owns issued documents cannot just
  disappear (the documents are legal records); it needs its own design with the
  accountant.

### E. Tests

- pgTAP: DF026 for a member on each of the three functions, owner and admin allowed;
  invitations (privileges, every refusal of `accept_invitation` gives DF027, wrong e-mail,
  expired, revoked, used twice, admin cannot invite an admin, nobody invites an owner);
  ownership transfer; the switch column.
- Concurrency: the same invitation accepted from two connections: one membership.
- e2e script `test:e2e-members`: owner invites, the invited user signs up, confirms,
  accepts; roles enforced through REST; isolation from a third user.
- Vitest: `useMyRole`, hidden buttons, the invitation page (button press, redirects), the
  organization switch.
- Browser: two accounts, desktop and 375 px.

### F. Order of work (one merge each)

1. **R1 roles per action:** DF026 in the three functions, `useMyRole`, screens.
2. **R2 invitations, database:** table, functions, pgTAP, concurrency.
3. **R3 invitations, screens:** members page (list, invite, revoke, remove, roles),
   invitation page, e2e script.
4. **R4 several organizations:** current organization column and switch.
5. **R5 leave and transfer ownership.**

---

## Part 3. Decisions to take

The developer approved the direction on 2026-10-15 with conditions, and asked for the exact
content of each decision before the final approval. Conditions, as given:
- permissions enforced in PostgreSQL (RLS, column privileges, functions), never only in the
  screens; direct table access and changes to issued documents checked too;
- invitations by link for the MVP; sending by e-mail later WITHOUT changing the data model;
- `profiles.current_organization_id` validated by the server, isolation kept everywhere;
- exactly ONE active owner per organization; atomic, safe transfer; no admin can make
  itself owner;
- automated tests of permissions, non-regression and multi-tenant isolation; existing
  features preserved.

| # | Decision (exact content) | Enforced by | Changes for existing users |
|---|---|---|---|
| R-1 | Issuing a document (`finalize_document`), recording a payment (`record_payment`) and cancelling a devis (`cancel_devis`) are allowed to `owner` and `admin` only. A `member` gets DF026. Clients, drafts and lines stay open to every member. | The three functions (`has_org_role`), after the membership check so another organization's document still answers DF001. Issued documents stay frozen for every role (triggers, unchanged). | None today: every existing account is the owner of its own organization. |
| R-2 | Converting a devis into a draft facture (`convert_devis_to_facture`) stays open to every member: it only creates a draft that an owner/admin must issue. | The function (membership only, unchanged). | None. |
| R-3 | One code, DF026, means "your role does not allow this action", with a French message. Tests and screens can tell it from 42501 (no access) and DF001 (not found). | `CLAUDE.md` table, `errorMessageKey()`, translations. | None. |
| R-4 | Invitations are delivered by a link the inviter copies (MVP). The table keeps everything an e-mail sender will need later (address, organization, role, expiry, state): adding e-mails later is a new sender, not a new model. | `organization_invitations` + SECURITY DEFINER functions; no API write on the table. | None. |
| R-5 | An invitation: ONE e-mail address (stored in lower case); the token is random, shown once, stored only as its SHA-256 hash; valid 7 days; usable once; revocable by owner/admin; accepted only by a signed-in user whose CONFIRMED e-mail is that address, after pressing a button. Every invalid case gives the same error (DF027). An address that is already a member gets DF028. | `accept_invitation()` in one transaction, row locked; concurrency test (two accepts at once: one membership). | None. |
| R-6 | Who invites: the owner may invite `admin` or `member`; an admin may invite `member` only; a member invites nobody. Nobody is ever invited as `owner`. | `create_invitation()`; CHECK on the table (`role in ('admin','member')`). | None. |
| R-7 | A user may belong to several organizations; the header shows the current one and, when there are several, a switch. Every query still names `organization_id`; RLS still decides. | Unchanged RLS; the switch only changes which organization the screens ask for. | Users with one organization see nothing new. |
| R-8 | The current organization is stored in `profiles.current_organization_id`, written ONLY through a function that checks the caller is a member of it (server validation). If the caller stops being a member, the app falls back to the first membership. No `localStorage`. | `set_current_organization()` SECURITY DEFINER; the column is not writable by the API role. | New nullable column; NULL means "first membership", as today. |
| R-9 | Account deletion is out of this sprint (issued documents are legal records). | Nothing built. | None. |
| R-10 | Exactly ONE owner per organization, at every moment, for every role: never two, never zero. (a) No direct path changes the owner: the owner's membership cannot be deleted, and its role cannot be changed, and no other membership can be given the role `owner`, by ANY role (trigger, not only RLS). (b) Ownership changes ONLY through `transfer_ownership(org, user)`, called by the current owner: the target must already be a member of the SAME organization; in one transaction, with the organization row locked FOR UPDATE (two transfers at once are serialized; the second one sees the new owner and is refused), the target becomes owner and the caller becomes admin. (c) After every successful transfer there is exactly one owner (checked in the function before commit, and by the constraint). An admin can never make itself owner. | A trigger on `organization_members` that refuses any insert, update or delete that would add, remove or change an owner unless it runs inside `transfer_ownership()` (a transaction-local flag set only by that function); a deferrable EXCLUDE constraint (at most one owner, checked at commit); the existing last-owner rule (DF020) kept as a second line. Tests: zero owner (delete, demote), two owners (promote, direct insert), two simultaneous transfers (concurrency script). | Existing data checked before the migration: every organization has exactly one owner. Owners can no longer remove themselves or promote a second owner directly. |

R-10 is new: the first draft allowed several owners (the last-owner rule implied it). It
follows the condition "a single active owner". Corrected on 2026-10-15 at the developer's
request: the EXCLUDE constraint alone only forbids TWO owners; the trigger and the
transfer function above also forbid ZERO.

### Security requirements for the invitations (R2, R3; recorded now, built later)

- The confirmed e-mail is read on the server from `auth.users` (`email` and
  `email_confirmed_at` of `auth.uid()`), never from the request or the token.
- Every SECURITY DEFINER function: `set search_path = ''`, fully qualified names,
  `REVOKE ALL ... FROM public, anon, authenticated, service_role`, then `GRANT EXECUTE` to
  `authenticated` only.
- DF027 is ONE answer for every invalid case (unknown token, expired, revoked, used, wrong
  address): it never says which.
- DF028 ("already a member") is returned only AFTER the invitation is found valid and its
  address matches the caller: it cannot be used to probe memberships.
- Tokens come from `gen_random_bytes(32)` (pgcrypto, a cryptographically secure generator),
  encoded for the URL; only their SHA-256 hash is stored.

### Impacts identified

- The three functions of R-1 change behaviour for a `member` only; no `member` exists yet
  (no invitation exists), so nobody loses an action today.
- Tests that call these functions as a member must expect DF026; the e2e and concurrency
  scripts run as owners and are unaffected.
- Screens: buttons a member cannot use are replaced by a sentence; the settings forms
  become read-only for whoever cannot save them (today they fail on save).
- R-10 needs a check before its migration that no organization has two owners, and changes
  the role-change rule (an owner can no longer name a second owner directly).
- Unknown and NOT assumed: whether Tunisian rules require a named person (and which role)
  to issue a facture. If they do, R-1 may need a stricter rule. To ask the accountant.

### What R1 contains (and nothing more)

DF026 in `finalize_document`, `record_payment`, `cancel_devis`; pgTAP for each role on each
function and for direct table access (a member still cannot write `status`, `number`,
snapshots, totals, payments, or any column of an issued document); `useMyRole()`; buttons
replaced for members; read-only settings for those who cannot save; Vitest; the full test
suite; a browser check. R2 to R5 wait for a separate approval. Nothing is applied to any
remote database.

### Notes added while building R2 (2026-10-16, branch `checkpoint/r2-invitations-db`)

- Built: `organization_invitations`, `create_invitation`, `revoke_invitation`,
  `accept_invitation`, migration `20261016090001_organization_invitations.sql`. No screen.
- `create_invitation` returns `(invitation_id, token, expires_at)`. A new invitation for the
  same address and organization REVOKES the pending one (one pending invitation per address;
  the old link stops working). The organization row is locked, so two creations in parallel
  cannot leave two pending invitations.
- `create_invitation` does NOT tell the inviter whether the address is already a member
  (that would be a way to probe memberships): the member finds out when accepting (DF028).
- A non-member calling `create_invitation` gets 42501; a member, an admin inviting an admin,
  or anyone inviting an owner gets DF026; an invalid address 22023.
- `revoke_invitation`: owner any pending invitation; admin member invitations only (DF026 for
  an admin one); anything else DF027 (an invitation of another organization looks unknown).
- New code DF029: a trigger freezes every invitation row except its one change from pending
  to accepted or revoked, for every role.
- Logs: Postgres logs the text of a failed statement. Through PostgREST the token is a
  parameter, and parameters are not logged on error locally
  (`log_parameter_max_length_on_error = 0`). The concurrency script put the token in the SQL
  text: its first run left 4 already-used tokens in the LOCAL container log; the script now
  turns that logging off for those sessions. To check on the hosted project (DEPLOYMENT.md).
- The local database was aligned BY HAND once (a constraint renamed with ALTER) after the
  migration file was edited before its first commit; the migration was never pushed. A
  replay from empty (`db:reset`) is the way to confirm it (it wipes local data: consent).
- Fixed on 2026-10-16 (migration `20261016090002_create_invitation_replace_rule.sql`): an
  admin could revoke the owner's pending ADMIN invitation by creating a MEMBER invitation for
  the same address (the replacement revoked it without checking the role). Found by a local
  adversarial probe (`scripts/security-invitation-probe.mjs`, untracked, not written in this
  session). Now only the owner may replace a pending admin invitation (DF026); pgTAP 5b.
- Reproducibility checked on 2026-10-16: every migration replayed from EMPTY on a separate,
  throwaway local stack (another project id and ports), then pgTAP, concurrency and the five
  e2e scripts on it, and its schema (`pg_dump --schema-only` of public and private, plus the
  triggers on `auth.users`) compared line by line with the working local database.

