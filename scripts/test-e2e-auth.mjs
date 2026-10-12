// End-to-end test of the auth flows against the LOCAL Supabase stack, through the same
// HTTP APIs the browser uses (Auth, REST) and the local mailbox (Mailpit).
//
//   npm run test:e2e-auth
//
// What pgTAP cannot show and this does:
//   * a real signup: the user row is inserted by the auth server's own database role, so
//     the signup trigger is exercised on its real path;
//   * the real emails: our French templates, their links to /auth/confirm with a token_hash;
//   * email confirmation, login, ensure_my_account over REST, password recovery.
//
// Rules of this script
//   * LOCAL ONLY: it refuses to run unless every URL reported by the CLI is on localhost.
//   * The keys are read from `supabase status` at runtime and are NEVER printed. Neither
//     are tokens or passwords.
//   * No dependency: Node's fetch + `docker exec psql` for the database checks.
//   * Cleanup uses `SET LOCAL session_replication_role = replica` (triggers off for that
//     one transaction), because the last owner of an organization cannot be deleted
//     otherwise. Acceptable only on the local test database.

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const config = readFileSync('supabase/config.toml', 'utf8')
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
const siteUrl = /^site_url\s*=\s*"([^"]+)"/m.exec(config)?.[1]
if (!projectId || !siteUrl) throw new Error('project_id / site_url not found in supabase/config.toml')
const container = `supabase_db_${projectId}`

const status = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
)
const apiUrl = status.API_URL
const mailUrl = status.MAILPIT_URL ?? status.INBUCKET_URL
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY
const isLocal = (url) => typeof url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)
if (!isLocal(apiUrl) || !isLocal(mailUrl)) {
  throw new Error('Refusing to run: the Supabase CLI did not report local URLs for the API and the mailbox.')
}
if (!anonKey) throw new Error('No anon key reported by `supabase status`.')

const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

/** Calls the local API. Returns the status and the parsed body; never logs either. */
async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json }
}

/** Waits for the newest email sent to `address` whose subject matches, and returns it. */
async function waitForEmail(address, subjectPattern, seenIds) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const search = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
    const { messages = [] } = await search.json()
    const match = messages.find((m) => !seenIds.has(m.ID) && subjectPattern.test(m.Subject))
    if (match) {
      seenIds.add(match.ID)
      const message = await (await fetch(`${mailUrl}/api/v1/message/${match.ID}`)).json()
      return { id: match.ID, subject: match.Subject, html: message.HTML ?? '', text: message.Text ?? '' }
    }
    await sleep(300)
  }
  return null
}

/** Checks an email built from one of our templates and returns the token_hash it carries. */
function inspectEmail(mail, type, label) {
  const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  const expectedPrefix = `${siteUrl}/auth/confirm?token_hash=`
  const link = links.find((href) => href.startsWith(expectedPrefix))
  const url = link ? new URL(link) : null
  const tokenHash = url?.searchParams.get('token_hash') ?? null
  check(links.length === 1 && Boolean(link), `${label}: the email has exactly one link, to ${siteUrl}/auth/confirm`,
    `links found: ${links.length}`)
  check(url?.searchParams.get('type') === type && Boolean(tokenHash) && [...(url?.searchParams.keys() ?? [])].length === 2,
    `${label}: the link carries only token_hash and type=${type}`)
  check(!/<img|<script|<iframe|<link|src=|background=|http-equiv/i.test(mail.html),
    `${label}: no image, script or remote resource in the email (no tracking)`)
  return tokenHash
}

const amrMethods = (accessToken) => {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'))
    return (payload.amr ?? []).map((entry) => entry.method).join(',')
  } catch {
    return '(unreadable)'
  }
}

const runId = randomUUID().slice(0, 8)
const email = `e2e-${runId}@test.local`
const unknownEmail = `e2e-nobody-${runId}@test.local`
const firstPassword = randomBytes(18).toString('base64url')
const secondPassword = randomBytes(18).toString('base64url')
const seenMail = new Set()
let userId = null

console.log(`Local API: ${apiUrl}   mailbox: ${mailUrl}   site_url: ${siteUrl}\n`)

try {
  // 1. Signup -----------------------------------------------------------------------------
  console.log('[1] signup through the Auth API')
  const shortPassword = await api('POST', '/auth/v1/signup', { body: { email: `e2e-short-${runId}@test.local`, password: '123456789' } })
  check(shortPassword.status === 422 && shortPassword.json?.error_code === 'weak_password',
    'a 9 character password is refused by the server (minimum is 10)',
    `HTTP ${shortPassword.status}, code ${shortPassword.json?.error_code}`)

  const signup = await api('POST', '/auth/v1/signup', { body: { email, password: firstPassword, data: { full_name: 'E2E Signup' } } })
  userId = signup.json?.id ?? signup.json?.user?.id ?? null
  check(signup.status === 200 && Boolean(userId), 'the signup is accepted', `HTTP ${signup.status}`)
  check(!signup.json?.access_token, 'no session is returned before the email is confirmed')
  if (!userId) throw new Error('signup failed; the other steps cannot run')

  const account = psql(`
select (select count(*) from public.profiles where id = '${userId}' and full_name = 'E2E Signup')
  || '/' || (select count(*) from public.organization_members where user_id = '${userId}' and role = 'owner')
  || '/' || (select count(*) from public.organizations o join public.organization_members m on m.organization_id = o.id where m.user_id = '${userId}' and o.name = 'E2E Signup')
  || '/' || (select count(*) from public.tax_settings t join public.organization_members m on m.organization_id = t.organization_id
             where m.user_id = '${userId}' and t.default_tva_rate is null and t.timbre_fiscal is null and t.retenue_rate is null
               and t.retenue_threshold is null and not t.timbre_enabled and not t.retenue_enabled);
`)
  check(account === '1/1/1/1', 'the signup trigger created the profile, the organization, the owner membership and empty tax settings',
    `profile/owner membership/organization/empty tax_settings: ${account}`)

  const earlyLogin = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password: firstPassword } })
  check(earlyLogin.status === 400 && !earlyLogin.json?.access_token, 'login is refused while the email is not confirmed',
    `HTTP ${earlyLogin.status}, code ${earlyLogin.json?.error_code}`)

  // 2. Anti-enumeration at the API level --------------------------------------------------
  console.log('\n[2] the API does not reveal whether an address is registered')
  await sleep(1500) // auth.email.max_frequency = 1s between two emails to the same address
  const again = await api('POST', '/auth/v1/signup', { body: { email, password: randomBytes(18).toString('base64url') } })
  check(again.status === 200 && !again.json?.access_token && !again.json?.error_code,
    'signing up again with the same address answers like a first signup (HTTP 200, no session, no error)',
    `HTTP ${again.status}`)
  check(Object.keys(again.json ?? {}).sort().join(',') === Object.keys(signup.json ?? {}).sort().join(','),
    'and the answer has the same fields as the first one')
  const recoverUnknown = await api('POST', '/auth/v1/recover', { body: { email: unknownEmail } })
  check(recoverUnknown.status === 200, 'a password reset for an unknown address answers HTTP 200', `HTTP ${recoverUnknown.status}`)

  // 3. Confirmation email -----------------------------------------------------------------
  console.log('\n[3] confirmation email (Mailpit) and email confirmation')
  const confirmationMail = await waitForEmail(email, /Confirmez votre adresse e-mail/, seenMail)
  check(confirmationMail !== null, 'the confirmation email arrived with its French subject',
    confirmationMail ? `subject: ${confirmationMail.subject}` : 'no email found')
  if (!confirmationMail) throw new Error('no confirmation email; the other steps cannot run')
  const confirmToken = inspectEmail(confirmationMail, 'email', 'confirmation')

  // What /auth/confirm does when the user presses the button: supabase.auth.verifyOtp().
  const verify = await api('POST', '/auth/v1/verify', { body: { type: 'email', token_hash: confirmToken } })
  const session = verify.json?.access_token
  check(verify.status === 200 && Boolean(session), 'verifying the token_hash confirms the address and opens a session', `HTTP ${verify.status}`)
  const reuse = await api('POST', '/auth/v1/verify', { body: { type: 'email', token_hash: confirmToken } })
  check(reuse.status >= 400 && !reuse.json?.access_token, 'the same link cannot be used twice',
    `HTTP ${reuse.status}, code ${reuse.json?.error_code}`)
  if (!session) throw new Error('email confirmation failed; the other steps cannot run')

  // 4. The logged-in user -----------------------------------------------------------------
  console.log('\n[4] the confirmed user through the REST API')
  const login = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password: firstPassword } })
  check(login.status === 200 && Boolean(login.json?.access_token), 'login works once the email is confirmed', `HTTP ${login.status}`)
  const wrongLogin = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password: `${firstPassword}x` } })
  const unknownLogin = await api('POST', '/auth/v1/token?grant_type=password', { body: { email: unknownEmail, password: firstPassword } })
  check(wrongLogin.status === 400 && unknownLogin.status === 400 && wrongLogin.json?.error_code === unknownLogin.json?.error_code,
    'a wrong password and an unknown address get the same error code',
    `codes: ${wrongLogin.json?.error_code} / ${unknownLogin.json?.error_code}`)

  const expectedOrg = psql(`select organization_id from public.organization_members where user_id = '${userId}';`)
  const ensure = await api('POST', '/rest/v1/rpc/ensure_my_account', { token: session, body: {} })
  check(ensure.status === 200 && ensure.json === expectedOrg, 'ensure_my_account returns the user\'s organization id', `HTTP ${ensure.status}`)
  const ensureAgain = await api('POST', '/rest/v1/rpc/ensure_my_account', { token: session, body: {} })
  const membershipCount = psql(`select count(*) from public.organization_members where user_id = '${userId}';`)
  check(ensureAgain.json === expectedOrg && membershipCount === '1', 'calling it again creates nothing: still one organization',
    `memberships: ${membershipCount}`)
  const organizations = await api('GET', '/rest/v1/organizations?select=id,name', { token: session })
  check(organizations.status === 200 && organizations.json?.length === 1 && organizations.json[0].id === expectedOrg,
    'the user sees exactly one organization: their own', `rows: ${organizations.json?.length}`)
  const insertMembership = await api('POST', '/rest/v1/organization_members', {
    token: session, body: { organization_id: expectedOrg, user_id: userId, role: 'owner' },
  })
  check(insertMembership.status === 403 || insertMembership.status === 401, 'the user cannot insert a membership through the API',
    `HTTP ${insertMembership.status}, code ${insertMembership.json?.code}`)

  const anonEnsure = await api('POST', '/rest/v1/rpc/ensure_my_account', { body: {} })
  check(anonEnsure.status === 401 && anonEnsure.json?.code === '42501', 'anon cannot call ensure_my_account',
    `HTTP ${anonEnsure.status}, code ${anonEnsure.json?.code}`)
  const anonOrganizations = await api('GET', '/rest/v1/organizations?select=id')
  check(anonOrganizations.status === 401 && anonOrganizations.json?.code === '42501', 'anon cannot read organizations',
    `HTTP ${anonOrganizations.status}, code ${anonOrganizations.json?.code}`)

  // 5. Password recovery ------------------------------------------------------------------
  console.log('\n[5] password recovery')
  await sleep(1500) // auth.email.max_frequency = 1s between two emails to the same address
  const recover = await api('POST', '/auth/v1/recover', { body: { email } })
  check(recover.status === 200 && JSON.stringify(recover.json) === JSON.stringify(recoverUnknown.json),
    'the reset request for a real address gets the same answer as for an unknown one', `HTTP ${recover.status}`)
  const recoveryMail = await waitForEmail(email, /Réinitialisation de votre mot de passe/, seenMail)
  check(recoveryMail !== null, 'the recovery email arrived with its French subject',
    recoveryMail ? `subject: ${recoveryMail.subject}` : 'no email found')
  const strayMail = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${unknownEmail}"`)}`).then((r) => r.json())
  check((strayMail.messages ?? []).length === 0, 'no email was sent to the unknown address')
  if (!recoveryMail) throw new Error('no recovery email; the other steps cannot run')
  const recoveryToken = inspectEmail(recoveryMail, 'recovery', 'recovery')

  const recoverySession = await api('POST', '/auth/v1/verify', { body: { type: 'recovery', token_hash: recoveryToken } })
  const recoveryAccess = recoverySession.json?.access_token
  check(recoverySession.status === 200 && Boolean(recoveryAccess), 'verifying the recovery token_hash opens a session',
    `HTTP ${recoverySession.status}${recoveryAccess ? `, session authenticated by: ${amrMethods(recoveryAccess)}` : ''}`)
  if (!recoveryAccess) throw new Error('recovery verification failed; the other steps cannot run')

  const shortNew = await api('PUT', '/auth/v1/user', { token: recoveryAccess, body: { password: '123456789' } })
  check(shortNew.status === 422, 'a 9 character new password is refused', `HTTP ${shortNew.status}, code ${shortNew.json?.error_code}`)
  const update = await api('PUT', '/auth/v1/user', { token: recoveryAccess, body: { password: secondPassword } })
  check(update.status === 200, 'the new password is accepted', `HTTP ${update.status}`)

  // What the reset page does next: supabase.auth.signOut({ scope: 'others' }).
  const signOutOthers = await api('POST', '/auth/v1/logout?scope=others', { token: recoveryAccess })
  check(signOutOthers.status === 204, 'signing out the other sessions is accepted', `HTTP ${signOutOthers.status}`)
  const oldRefresh = await api('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: login.json?.refresh_token } })
  check(oldRefresh.status >= 400 && !oldRefresh.json?.access_token, 'the session opened before the reset can no longer be refreshed',
    `HTTP ${oldRefresh.status}, code ${oldRefresh.json?.error_code}`)
  const currentRefresh = await api('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: recoverySession.json?.refresh_token } })
  check(currentRefresh.status === 200 && Boolean(currentRefresh.json?.access_token), 'the session that changed the password is still valid',
    `HTTP ${currentRefresh.status}`)

  const oldPasswordLogin = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password: firstPassword } })
  check(oldPasswordLogin.status === 400, 'the old password no longer works', `HTTP ${oldPasswordLogin.status}`)
  const newPasswordLogin = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password: secondPassword } })
  check(newPasswordLogin.status === 200 && Boolean(newPasswordLogin.json?.access_token), 'the new password works', `HTTP ${newPasswordLogin.status}`)
} catch (error) {
  console.log(`\nABORTED: ${error.message}`)
  failures.push('aborted')
} finally {
  // LOCAL TEST DATABASE ONLY: triggers off for this cleanup transaction (see the header).
  try {
    psql(`
begin;
set local session_replication_role = replica;
create temp table doomed_users on commit drop as select id from auth.users where email like 'e2e-%-${runId}@test.local' or email = '${email}';
create temp table doomed_orgs on commit drop as
  select distinct organization_id as id from public.organization_members where user_id in (select id from doomed_users);
delete from public.tax_settings where organization_id in (select id from doomed_orgs);
delete from public.organization_members where organization_id in (select id from doomed_orgs);
delete from public.organizations where id in (select id from doomed_orgs);
delete from public.profiles where id in (select id from doomed_users);
delete from auth.refresh_tokens where user_id in (select id::text from doomed_users);
delete from auth.sessions where user_id in (select id from doomed_users);
delete from auth.mfa_amr_claims where session_id not in (select id from auth.sessions);
delete from auth.one_time_tokens where user_id in (select id from doomed_users);
delete from auth.identities where user_id in (select id from doomed_users);
delete from auth.users where id in (select id from doomed_users);
commit;
`)
    for (const id of seenMail) {
      await fetch(`${mailUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [id] }) })
    }
    const left = psql(`select count(*) from auth.users where email like '%${runId}@test.local';`)
    console.log(left === '0' ? '\nThrowaway user removed.' : `\nWARNING: ${left} test user(s) left in the LOCAL database.`)
  } catch (error) {
    console.log(`\nWARNING: cleanup failed (npm run db:reset removes the test user): ${String(error.message).split('\n')[0]}`)
  }
}

console.log(failures.length === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures.length} check${failures.length > 1 ? 's' : ''} failed)`)
process.exit(failures.length === 0 ? 0 : 1)
