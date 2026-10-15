// End-to-end test of payments and of cancelling a devis (P2e) through the REAL local stack:
// Supabase Auth, PostgREST, RLS, privileges, record_payment(), cancel_devis() and the
// triggers, exactly as the browser reaches them (anon key + the user's token). It proves
// what the mocked tests cannot:
//   * the API role cannot insert a payment directly (42501): record_payment() is its path;
//   * the amount travels as TEXT: a JSON number is refused (DF024), "40.000" is accepted;
//   * payments are read back as text and add up with paymentState() of src/lib/money;
//   * an overpayment is refused (DF018) and the last payment sets 'paid' by itself;
//   * another user can neither pay, read the payments nor cancel (DF001, empty list);
//   * a devis is cancelled by cancel_devis(), never once a facture was converted from it (DF021).
//
//   npm run test:e2e-payments      (needs the local stack: npm run db:start)
//
// Same rules as test-e2e-documents.mjs: LOCAL ONLY, keys read at runtime and never printed,
// no dependency, throwaway users removed at the end (triggers off for that ONE cleanup
// transaction). Documents are issued by the real finalize_document(); no status is written
// by hand. The amounts below are test data.

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { computeTotals, fromDbNumeric, fromDbQuantity, fromDbRate, paymentState, toDbNumeric } from '../src/lib/money/money.ts'

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
const emailA = `e2e-payments-a-${runId}@test.local`
const emailB = `e2e-payments-b-${runId}@test.local`
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


const SINGLE = { Accept: 'application/vnd.pgrst.object+json', Prefer: 'return=representation' }
const rpc = (name, token, body) => api('POST', `/rest/v1/rpc/${name}`, { token, body })
const statusOf = (documentId) => psql(`select status::text from public.documents where id = '${documentId}';`)

/** Creates a draft with one line over REST and issues it with the real finalize_document(). */
async function issue(user, clientId, type) {
  const created = await api('POST', '/rest/v1/documents?select=id', {
    token: user.token, headers: SINGLE, body: { organization_id: user.organizationId, type, client_id: clientId },
  })
  const id = created.json?.id
  if (created.status !== 201 || !UUID.test(id ?? '')) throw new Error(`draft not created: HTTP ${created.status}`)
  const line = await api('POST', '/rest/v1/document_items', {
    token: user.token,
    body: { organization_id: user.organizationId, document_id: id, description: 'Ligne E2E', quantity: '1.000', unit_price: '100.000', tva_rate: '0.000' },
  })
  if (line.status !== 201) throw new Error(`line not created: HTTP ${line.status}`)
  const rows = (await api('GET', `/rest/v1/document_items?select=quantity::text,unit_price::text,tva_rate::text&organization_id=eq.${user.organizationId}&document_id=eq.${id}`, { token: user.token })).json
  const expected = toDbNumeric(computeTotals({
    lines: rows.map((row) => ({ quantity: fromDbQuantity(row.quantity), unitPrice: fromDbNumeric(row.unit_price), tvaRate: fromDbRate(row.tva_rate) })),
    timbre: null,
  }).netAPayer)
  const issued = await rpc('finalize_document', user.token, { p_document_id: id, p_expected_net_a_payer: expected })
  if (issued.status !== 200) throw new Error(`finalize failed: HTTP ${issued.status}, code ${issued.json?.code}`)
  return id
}

/** The payments of a facture, as src/features/documents/paymentsApi.ts reads them. */
const readPayments = (user, documentId) => api('GET',
  `/rest/v1/payments?select=id,amount::text,paid_at,method&organization_id=eq.${user.organizationId}&document_id=eq.${documentId}&order=paid_at,created_at,id&limit=1000`,
  { token: user.token })

console.log(`Local API: ${apiUrl}\n`)

try {
  console.log('[1] two throwaway users sign up through the Auth API')
  const a = await createUser(emailA, 'E2E Payments A')
  const b = await createUser(emailB, 'E2E Payments B')
  check(a.organizationId !== b.organizationId, 'each user got an organization of their own')

  console.log('\n[2] A issues a facture and two devis of 100.000, one devis converted into a draft facture')
  const client = await api('POST', '/rest/v1/clients?select=id', { token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, name: 'Client E2E' } })
  const clientId = client.json?.id
  const facture = await issue(a, clientId, 'facture')
  const devis = await issue(a, clientId, 'devis')
  const convertedDevis = await issue(a, clientId, 'devis')
  const converted = await api('POST', '/rest/v1/documents?select=id', {
    token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, type: 'facture', client_id: clientId, converted_from: convertedDevis },
  })
  check(statusOf(facture) === 'sent' && statusOf(devis) === 'sent' && converted.status === 201,
    'the three documents are issued, and a draft facture points at the second devis', `facture ${statusOf(facture)}, converted draft HTTP ${converted.status}`)

  console.log('\n[3] the API role cannot insert a payment directly')
  const direct = await api('POST', '/rest/v1/payments', {
    token: a.token, body: { organization_id: a.organizationId, document_id: facture, amount: '10.000', paid_at: '2026-10-15', method: 'cash' },
  })
  check(direct.status === 403 && direct.json?.code === '42501', 'POST /payments is refused (42501)', `HTTP ${direct.status}, code ${direct.json?.code}`)

  console.log('\n[4] record_payment: the amount travels as text')
  const pay = (user, amount, documentId = facture) =>
    rpc('record_payment', user.token, { p_document_id: documentId, p_amount: amount, p_paid_at: '2026-10-15', p_method: 'virement' })
  const asNumber = await pay(a, 40)
  check(asNumber.status === 400 && asNumber.json?.code === 'DF024', 'a JSON number is refused (DF024)', `HTTP ${asNumber.status}, code ${asNumber.json?.code}`)
  for (const text of ['40', '1e3', '40,000', '0.000']) {
    const refused = await pay(a, text)
    check(refused.status === 400 && refused.json?.code === 'DF024', `"${text}" is refused (DF024)`, `HTTP ${refused.status}, code ${refused.json?.code}`)
  }
  const first = await pay(a, '40.000')
  check(first.status === 200 && UUID.test(first.json?.id ?? ''), '"40.000" is recorded', `HTTP ${first.status}`)
  check(statusOf(facture) === 'sent', 'a partial payment leaves the facture sent', statusOf(facture))

  const listed = await readPayments(a, facture)
  check(listed.status === 200 && listed.json?.length === 1 && listed.json[0].amount === '40.000' && listed.json[0].paid_at === '2026-10-15',
    'the payment is read back as text, with its day', listed.text)
  const state = paymentState(fromDbNumeric('100.000'), listed.json.map((row) => fromDbNumeric(row.amount)))
  check(state.paid === 40000 && state.remaining === 60000, 'paymentState() gives 40.000 paid and 60.000 remaining', JSON.stringify(state))

  console.log('\n[5] B, another organization')
  const bPays = await pay(b, '1.000')
  check(bPays.status === 400 && bPays.json?.code === 'DF001', "B cannot pay A's facture: DF001, as for an unknown id", `HTTP ${bPays.status}, code ${bPays.json?.code}`)
  const bReads = await api('GET', `/rest/v1/payments?select=id&document_id=eq.${facture}`, { token: b.token })
  check(bReads.status === 200 && bReads.json?.length === 0, "B reads none of A's payments", bReads.text)
  const bCancels = await rpc('cancel_devis', b.token, { p_devis_id: devis })
  check(bCancels.status === 400 && bCancels.json?.code === 'DF001', "B cannot cancel A's devis (DF001)", `HTTP ${bCancels.status}, code ${bCancels.json?.code}`)

  console.log('\n[6] overpayment, then the exact remaining amount')
  const over = await pay(a, '60.001')
  check(over.status === 400 && over.json?.code === 'DF018', 'one millime over the remaining amount is refused (DF018)', `HTTP ${over.status}, code ${over.json?.code}`)
  const last = await pay(a, toDbNumeric(state.remaining))
  check(last.status === 200, `the remaining "${toDbNumeric(state.remaining)}" is recorded`, `HTTP ${last.status}`)
  check(statusOf(facture) === 'paid', 'and the facture is paid, by Postgres', statusOf(facture))
  const after = await pay(a, '1.000')
  check(after.status === 400 && after.json?.code === 'DF016', 'a paid facture takes no more payment (DF016)', `HTTP ${after.status}, code ${after.json?.code}`)
  const anon = await api('POST', '/rest/v1/rpc/record_payment', { body: { p_document_id: facture, p_amount: '1.000', p_paid_at: '2026-10-15', p_method: 'cash' } })
  check(anon.status === 401 && anon.json?.code === '42501', 'anon cannot call record_payment', `HTTP ${anon.status}, code ${anon.json?.code}`)

  console.log('\n[7] cancel_devis')
  const blocked = await rpc('cancel_devis', a.token, { p_devis_id: convertedDevis })
  check(blocked.status === 400 && blocked.json?.code === 'DF021', 'a devis with a converted facture cannot be cancelled (DF021)', `HTTP ${blocked.status}, code ${blocked.json?.code}`)
  const cancelled = await rpc('cancel_devis', a.token, { p_devis_id: devis })
  check(cancelled.status === 200 && statusOf(devis) === 'cancelled', 'A cancels the other devis', `HTTP ${cancelled.status}, status ${statusOf(devis)}`)
  const twice = await rpc('cancel_devis', a.token, { p_devis_id: devis })
  check(twice.status === 400 && twice.json?.code === 'DF012', 'cancelling it again is refused (DF012)', `HTTP ${twice.status}, code ${twice.json?.code}`)
  const statusPatch = await api('PATCH', `/rest/v1/documents?id=eq.${facture}`, { token: a.token, body: { status: 'sent' } })
  check(statusPatch.status === 403 && statusPatch.json?.code === '42501', 'the API role still cannot write a status (42501)', `HTTP ${statusPatch.status}`)
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
delete from public.payments where organization_id in (select id from doomed_orgs);
delete from public.document_items where organization_id in (select id from doomed_orgs);
delete from public.documents where organization_id in (select id from doomed_orgs);
delete from public.document_counters where organization_id in (select id from doomed_orgs);
delete from public.clients where organization_id in (select id from doomed_orgs);
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
