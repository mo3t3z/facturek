# Design: roles per action and invitations (Sprint 12, design only)

Written 2026-10-15 on `checkpoint/roles-design` from `main` (`d3794e0`). Nothing here is
built. It waits for the developer's approval of the decisions in Part 3, like
`docs/p2e-design.md` did.

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

| # | Question | Proposal |
|---|---|---|
| R-1 | A member prepares, only owner/admin issue, record payments and cancel | Yes |
| R-2 | A member may convert a devis into a draft facture | Yes (it only creates a draft) |
| R-3 | Refusal code DF026 for a role that is not allowed | Yes |
| R-4 | Invitations by a link the inviter copies, no e-mail sent by the app (for now) | Yes |
| R-5 | An invitation is for ONE e-mail address and must be accepted by that confirmed address, within 7 days, once | Yes |
| R-6 | Admin may invite members only; nobody is invited as owner (ownership is transferred) | Yes |
| R-7 | Several organizations per user, with a switch in the header | Yes |
| R-8 | The current organization is stored in `profiles.current_organization_id`, not in localStorage | Yes |
| R-9 | Account deletion is out of this sprint | Yes |

Unknown and NOT assumed: whether Tunisian rules require a named person (and which role)
to sign or issue a facture. If they do, R-1 may need a stricter rule. To ask the
accountant along with the other questions.
