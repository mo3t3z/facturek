// End-to-end test of the settings through the REAL local stack: Supabase Auth, PostgREST
// and RLS, exactly as the browser reaches them (anon key + the user's token). It proves
// what the mocked component tests cannot:
//   * a numeric column selected with ::text really comes back as a JSON string, and as a
//     JSON number (a float in JavaScript) without it;
//   * a numeric column really accepts a string in an UPDATE, with every decimal kept;
//   * RLS: another user can neither read nor update these settings, and such an UPDATE is
//     NOT an error for PostgREST (0 rows) unless one object is requested, which is what
//     supabase-js .single() does (406 / PGRST116).
//
//   npm run test:e2e-settings      (needs the local stack: npm run db:start)
//
// Rules of this script (same as test-e2e-auth.mjs)
//   * LOCAL ONLY: it refuses to run unless the URL reported by the CLI is on localhost.
//   * The keys are read from `supabase status` at runtime and are NEVER printed. Neither
//     are tokens or passwords.
//   * No dependency: Node's fetch + `docker exec psql`.
//   * The two throwaway users sign up through the real Auth API (so the signup trigger
//     creates their accounts). Their e-mail is then confirmed with one UPDATE of those two
//     auth.users rows, by id, instead of reading the mailbox: the e-mail flow is the
//     subject of test-e2e-auth.mjs, not of this script.
//   * Cleanup removes the users of this run, selected by their exact addresses, and what
//     belongs to them. Triggers are off for that one transaction because the last owner
//     of an organization cannot be deleted otherwise. Nothing else is touched.
//   * The rates and amounts below are test data, not tax values.

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const config = readFileSync('supabase/config.toml', 'utf8')
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
if (!projectId) throw new Error('project_id not found in supabase/config.toml')
const container = `supabase_db_${projectId}`

const status = JSON.parse(
  execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
)
const apiUrl = status.API_URL
const mailUrl = status.MAILPIT_URL ?? status.INBUCKET_URL
const anonKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY
const isLocal = (url) => typeof url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)
if (!isLocal(apiUrl)) throw new Error('Refusing to run: the Supabase CLI did not report a local API URL.')
if (!anonKey) throw new Error('No anon key reported by `supabase status`.')

const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

/** Calls the local API. Returns the status, the parsed body and the RAW text; never logs a key or a token. */
async function api(method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      'Content-Type': 'application/json',
      ...headers,
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
  return { status: response.status, json, text }
}

const runId = randomUUID().slice(0, 8)
const emailA = `e2e-settings-a-${runId}@test.local`
const emailB = `e2e-settings-b-${runId}@test.local`
// Every address this run creates a user for. Cleanup removes these users and nothing else.
const runEmails = [emailA, emailB]
const emailList = runEmails.map((address) => `'${address}'`).join(', ')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Signs a throwaway user up through the Auth API, confirms it, logs in. Returns its token and organization. */
async function createUser(email, fullName) {
  const password = randomBytes(18).toString('base64url')
  const signup = await api('POST', '/auth/v1/signup', { body: { email, password, data: { full_name: fullName } } })
  const userId = signup.json?.id ?? signup.json?.user?.id ?? null
  if (signup.status !== 200 || !UUID.test(userId ?? '')) throw new Error(`signup failed for ${fullName}: HTTP ${signup.status}`)
  // LOCAL TEST DATABASE ONLY: confirm this one user, by id (see the header).
  psql(`update auth.users set email_confirmed_at = now() where id = '${userId}' and email = '${email}';`)
  const login = await api('POST', '/auth/v1/token?grant_type=password', { body: { email, password } })
  const token = login.json?.access_token
  if (login.status !== 200 || !token) throw new Error(`login failed for ${fullName}: HTTP ${login.status}`)
  const account = await api('POST', '/rest/v1/rpc/ensure_my_account', { token, body: {} })
  const organizationId = account.json
  if (account.status !== 200 || !UUID.test(organizationId ?? '')) throw new Error(`ensure_my_account failed for ${fullName}: HTTP ${account.status}`)
  return { userId, token, organizationId }
}

const TAX_TEXT = 'organization_id,default_tva_rate::text,timbre_enabled,timbre_fiscal::text'
const taxPath = (organizationId, select) => `/rest/v1/tax_settings?select=${select}&organization_id=eq.${organizationId}`
// What supabase-js sends for .single(): "exactly one object, or it is an error".
const SINGLE = { Accept: 'application/vnd.pgrst.object+json', Prefer: 'return=representation' }
const REPRESENTATION = { Prefer: 'return=representation' }

console.log(`Local API: ${apiUrl}\n`)

try {
  console.log('[1] two throwaway users sign up through the Auth API')
  const a = await createUser(emailA, 'E2E Settings A')
  const b = await createUser(emailB, 'E2E Settings B')
  check(a.organizationId !== b.organizationId, 'each user got an organization of their own')

  // 2. A new account -------------------------------------------------------------------------
  console.log('\n[2] a new account has no tax value at all')
  const fresh = await api('GET', taxPath(a.organizationId, TAX_TEXT), { token: a.token })
  const freshRow = fresh.json?.[0]
  check(fresh.status === 200 && fresh.json?.length === 1, 'the owner reads exactly one tax_settings row', `HTTP ${fresh.status}`)
  check(freshRow?.default_tva_rate === null && freshRow?.timbre_fiscal === null && freshRow?.timbre_enabled === false,
    'default_tva_rate and timbre_fiscal are NULL, timbre_enabled is false', fresh.text)

  // 3. Strings in, strings out ---------------------------------------------------------------
  console.log('\n[3] numerics are written and read as strings')
  const write = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: a.token,
    headers: SINGLE,
    body: { default_tva_rate: '7.125', timbre_enabled: true, timbre_fiscal: '1234567.891' },
  })
  check(write.status === 200, 'an UPDATE with the numerics given as JSON strings is accepted', `HTTP ${write.status}`)
  check(write.json?.default_tva_rate === '7.125' && write.json?.timbre_fiscal === '1234567.891' && write.json?.timbre_enabled === true,
    'the row returned by the UPDATE carries the same strings', write.text)

  const read = await api('GET', taxPath(a.organizationId, TAX_TEXT), { token: a.token })
  const row = read.json?.[0]
  check(typeof row?.default_tva_rate === 'string' && typeof row?.timbre_fiscal === 'string',
    'read back with ::text: both values are JSON strings',
    `typeof default_tva_rate: ${typeof row?.default_tva_rate}, typeof timbre_fiscal: ${typeof row?.timbre_fiscal}`)
  check(read.text.includes('"default_tva_rate":"7.125"') && read.text.includes('"timbre_fiscal":"1234567.891"'),
    'the raw response body has them in quotes, with every decimal', read.text)

  const stored = psql(`select default_tva_rate::text || '|' || timbre_fiscal::text || '|' || timbre_enabled::text from public.tax_settings where organization_id = '${a.organizationId}';`)
  check(stored === '7.125|1234567.891|true', 'the database holds exactly these values', stored)

  const asNumber = await api('GET', taxPath(a.organizationId, 'default_tva_rate,timbre_fiscal'), { token: a.token })
  check(typeof asNumber.json?.[0]?.default_tva_rate === 'number' && typeof asNumber.json?.[0]?.timbre_fiscal === 'number',
    'WITHOUT ::text the same columns come back as JSON numbers (floats in JavaScript): this is what the app must never do',
    asNumber.text)

  const trailing = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: a.token, headers: SINGLE, body: { default_tva_rate: '19.000', timbre_fiscal: '1.000' },
  })
  check(trailing.json?.default_tva_rate === '19.000' && trailing.json?.timbre_fiscal === '1.000',
    'trailing zeros are kept: always 3 decimals, the form fromDbNumeric / fromDbRate expect', trailing.text)

  const cleared = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: a.token, headers: SINGLE, body: { default_tva_rate: null, timbre_enabled: false, timbre_fiscal: null },
  })
  check(cleared.status === 200 && cleared.json?.default_tva_rate === null && cleared.json?.timbre_fiscal === null,
    'empty fields are stored as NULL', cleared.text)

  // CHECK tax_settings_timbre_enabled_has_amount: the amount is NULL at this point.
  const switchOnly = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), { token: a.token, headers: SINGLE, body: { timbre_enabled: true } })
  check(switchOnly.status === 400 && switchOnly.json?.code === '23514',
    'enabling the timbre without an amount is refused by the database (23514)', `HTTP ${switchOnly.status}, code ${switchOnly.json?.code}`)
  const stillOff = psql(`select timbre_enabled::text || '|' || coalesce(timbre_fiscal::text, 'NULL') from public.tax_settings where organization_id = '${a.organizationId}';`)
  check(stillOff === 'false|NULL', 'and nothing was written', stillOff)

  const tooLarge = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: a.token, headers: SINGLE, body: { default_tva_rate: '100.001' },
  })
  check(tooLarge.status === 400 && tooLarge.json?.code === '23514', 'a rate above 100 is refused by the database (23514)',
    `HTTP ${tooLarge.status}, code ${tooLarge.json?.code}`)

  const restored = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: a.token, headers: SINGLE, body: { default_tva_rate: '7.125', timbre_enabled: true, timbre_fiscal: '1234567.891' },
  })
  check(restored.status === 200, 'the values are set again for the isolation checks', `HTTP ${restored.status}`)

  // 4. Another user ----------------------------------------------------------------------------
  console.log('\n[4] a second user cannot read or change them')
  const foreignRead = await api('GET', taxPath(a.organizationId, TAX_TEXT), { token: b.token })
  check(foreignRead.status === 200 && Array.isArray(foreignRead.json) && foreignRead.json.length === 0,
    'B reading A\'s tax settings gets no row', `HTTP ${foreignRead.status}, rows: ${foreignRead.json?.length}`)

  const everything = await api('GET', `/rest/v1/tax_settings?select=organization_id`, { token: b.token })
  check(everything.json?.length === 1 && everything.json[0].organization_id === b.organizationId,
    'B reading the whole table sees only their own row', `rows: ${everything.json?.length}`)

  const foreignWrite = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: b.token, headers: REPRESENTATION, body: { default_tva_rate: '99.000', timbre_fiscal: '0.001' },
  })
  check(foreignWrite.status === 200 && Array.isArray(foreignWrite.json) && foreignWrite.json.length === 0,
    'B updating A\'s tax settings is NOT an error for PostgREST: it answers 200 with 0 rows',
    `HTTP ${foreignWrite.status}, rows: ${foreignWrite.json?.length}`)

  const foreignSingle = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), {
    token: b.token, headers: SINGLE, body: { default_tva_rate: '99.000', timbre_fiscal: '0.001' },
  })
  check(foreignSingle.status === 406 && foreignSingle.json?.code === 'PGRST116',
    'the same UPDATE asking for one object (.single()) fails with PGRST116: this is how the app detects it',
    `HTTP ${foreignSingle.status}, code ${foreignSingle.json?.code}`)

  const organizationPath = (id) => `/rest/v1/organizations?select=id,name&id=eq.${id}`
  const foreignOrganizationRead = await api('GET', organizationPath(a.organizationId), { token: b.token })
  check(foreignOrganizationRead.json?.length === 0, 'B cannot read A\'s organization', `rows: ${foreignOrganizationRead.json?.length}`)
  const foreignOrganization = await api('PATCH', organizationPath(a.organizationId), {
    token: b.token, headers: SINGLE, body: { name: 'Taken over' },
  })
  check(foreignOrganization.status === 406 && foreignOrganization.json?.code === 'PGRST116',
    'B cannot rename A\'s organization (PGRST116)', `HTTP ${foreignOrganization.status}, code ${foreignOrganization.json?.code}`)

  const anonRead = await api('GET', taxPath(a.organizationId, TAX_TEXT))
  check(anonRead.status === 401 || anonRead.status === 403 || (Array.isArray(anonRead.json) && anonRead.json.length === 0),
    'without a session nothing is readable', `HTTP ${anonRead.status}`)

  const after = psql(`select t.default_tva_rate::text || '|' || t.timbre_fiscal::text || '|' || o.name from public.tax_settings t join public.organizations o on o.id = t.organization_id where t.organization_id = '${a.organizationId}';`)
  check(after === '7.125|1234567.891|E2E Settings A', 'after B\'s attempts, A\'s settings and name are unchanged in the database', after)

  // 5. Organization identity -------------------------------------------------------------------
  console.log('\n[5] the owner edits the organization identity')
  const identity = await api('PATCH', `/rest/v1/organizations?select=id,name,matricule_fiscal,address,email,phone&id=eq.${a.organizationId}`, {
    token: a.token, headers: SINGLE, body: { name: 'E2E Atelier', matricule_fiscal: null, address: '12 rue de Carthage', email: null, phone: null },
  })
  check(identity.status === 200 && identity.json?.name === 'E2E Atelier' && identity.json?.matricule_fiscal === null && identity.json?.address === '12 rue de Carthage',
    'the owner renames the organization; empty fields are NULL', `HTTP ${identity.status}`)
  const blank = await api('PATCH', organizationPath(a.organizationId), { token: a.token, headers: SINGLE, body: { name: '   ' } })
  check(blank.status === 400 && blank.json?.code === '23514', 'a blank name is refused by the database (23514)',
    `HTTP ${blank.status}, code ${blank.json?.code}`)
  const retenue = await api('PATCH', taxPath(a.organizationId, TAX_TEXT), { token: a.token, headers: SINGLE, body: { timbre_enabled: true } })
  const retenueStored = psql(`select retenue_enabled::text || '|' || coalesce(retenue_rate::text, 'NULL') || '|' || coalesce(retenue_threshold::text, 'NULL') from public.tax_settings where organization_id = '${a.organizationId}';`)
  check(retenue.status === 200 && retenueStored === 'false|NULL|NULL', 'the retenue columns were never touched', retenueStored)
} catch (error) {
  console.log(`\nABORTED: ${error.message}`)
  failures.push('aborted')
} finally {
  // LOCAL TEST DATABASE ONLY: triggers off for this cleanup transaction (see the header).
  try {
    psql(`
begin;
set local session_replication_role = replica;
create temp table doomed_users on commit drop as
  select id from auth.users where email in (${emailList});
-- Only the organizations whose EVERY member is a user of this run: an organization that also
-- has someone else (a real account, once invitations exist) is never deleted, only this
-- run's memberships in it are.
create temp table doomed_orgs on commit drop as
  select distinct m.organization_id as id from public.organization_members m
  where m.user_id in (select id from doomed_users)
    and not exists (select 1 from public.organization_members other
                    where other.organization_id = m.organization_id
                      and other.user_id not in (select id from doomed_users));
delete from public.tax_settings where organization_id in (select id from doomed_orgs);
delete from public.organization_members where organization_id in (select id from doomed_orgs);
delete from public.organization_members where user_id in (select id from doomed_users);
delete from public.organizations where id in (select id from doomed_orgs);
delete from public.profiles where id in (select id from doomed_users);
delete from auth.refresh_tokens where user_id in (select id::text from doomed_users);
delete from auth.mfa_amr_claims
  where session_id in (select id from auth.sessions where user_id in (select id from doomed_users));
delete from auth.sessions where user_id in (select id from doomed_users);
delete from auth.one_time_tokens where user_id in (select id from doomed_users);
delete from auth.identities where user_id in (select id from doomed_users);
delete from auth.users where id in (select id from doomed_users);
commit;
`)
    // The two confirmation e-mails of this run, found by their recipient.
    if (isLocal(mailUrl)) {
      for (const address of runEmails) {
        const search = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)
        const { messages = [] } = await search.json()
        const ids = messages.map((message) => message.ID)
        if (ids.length > 0) {
          await fetch(`${mailUrl}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: ids }) })
        }
      }
    }
    const left = psql(`select count(*) from auth.users where email in (${emailList});`)
    console.log(left === '0' ? '\nThrowaway users removed.' : `\nWARNING: ${left} test user(s) left in the LOCAL database.`)
  } catch (error) {
    console.log(`\nWARNING: cleanup failed (npm run db:reset removes the test users): ${String(error.message).split('\n')[0]}`)
  }
}

console.log(failures.length === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures.length} check${failures.length > 1 ? 's' : ''} failed)`)
process.exit(failures.length === 0 ? 0 : 1)
