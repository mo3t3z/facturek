// End-to-end test of the documents list and of the draft header through the REAL local
// stack: Supabase Auth, PostgREST, RLS, the column privileges and the guard triggers,
// exactly as the browser reaches them (anon key + the user's token). It proves what the
// mocked component tests cannot:
//   * the list query of the app (explicit columns, client name embedded through the
//     composite foreign key documents_client_fk) really works;
//   * the API role can insert a draft with the six allowed columns and nothing else
//     (status, number and year are refused);
//   * dates go in and come back as the same "YYYY-MM-DD" text;
//   * another user can neither see, update nor delete the document;
//   * once the document is issued, its owner can no longer update or delete it, and
//     PostgREST reports that as "0 rows" (PGRST116 when one object is requested).
//
//   npm run test:e2e-documents      (needs the local stack: npm run db:start)
//
// How the document becomes 'sent': through the REAL public.finalize_document(), called by
// its owner over REST, after adding one line over REST (finalize refuses a document
// without lines, DF004). No trigger is disabled, no constraint is dropped and no status
// is written by hand to get there.
//
// Rules of this script (same as test-e2e-settings.mjs)
//   * LOCAL ONLY: it refuses to run unless the URL reported by the CLI is on localhost.
//   * The keys are read from `supabase status` at runtime and are NEVER printed. Neither
//     are tokens or passwords.
//   * No dependency: Node's fetch + `docker exec psql`.
//   * The two throwaway users sign up through the real Auth API. Their e-mail is then
//     confirmed with one UPDATE of those two auth.users rows, by id.
//   * Cleanup removes the users of this run, selected by their exact addresses, and what
//     belongs to their organizations. As in the other scripts, triggers are off for that
//     ONE cleanup transaction: an issued document and the last owner of an organization
//     cannot be deleted by any role otherwise (that is the point of the guard triggers).
//     Nothing else is touched.
//   * The quantity, price and rate below are test data, not tax values.

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
const emailA = `e2e-documents-a-${runId}@test.local`
const emailB = `e2e-documents-b-${runId}@test.local`
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

// The same columns, filter, order and limit as src/features/documents/api.ts.
const LIST = 'id,type,number,year,status,issue_date,due_date,buyer_name,client:clients(name)'
const DETAIL = 'id,type,number,year,status,client_id,issue_date,due_date,notes,buyer_name,buyer_matricule_fiscal,buyer_address'
const listPath = (organizationId) =>
  `/rest/v1/documents?select=${LIST}&organization_id=eq.${organizationId}&order=created_at.desc&limit=1000`
const onePath = (organizationId, documentId, select = 'id') =>
  `/rest/v1/documents?select=${select}&organization_id=eq.${organizationId}&id=eq.${documentId}`
// What supabase-js sends for .single(): "exactly one object, or it is an error".
const SINGLE = { Accept: 'application/vnd.pgrst.object+json', Prefer: 'return=representation' }
const REPRESENTATION = { Prefer: 'return=representation' }
const dbDocument = (documentId) =>
  psql(`select status::text || '|' || coalesce(number::text, 'NULL') || '|' || coalesce(issue_date::text, 'NULL') || '|' || coalesce(due_date::text, 'NULL') || '|' || coalesce(notes, 'NULL') from public.documents where id = '${documentId}';`)

console.log(`Local API: ${apiUrl}\n`)

try {
  console.log('[1] two throwaway users sign up through the Auth API')
  const a = await createUser(emailA, 'E2E Documents A')
  const b = await createUser(emailB, 'E2E Documents B')
  check(a.organizationId !== b.organizationId, 'each user got an organization of their own')

  // 2. A creates a client and a draft ---------------------------------------------------------
  console.log('\n[2] A creates a client and a draft, with the payload of the app')
  const client = await api('POST', '/rest/v1/clients?select=id', {
    token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, name: 'Client E2E' },
  })
  const clientId = client.json?.id
  check(client.status === 201 && UUID.test(clientId ?? ''), 'the client is created', `HTTP ${client.status}`)

  const draftPayload = {
    organization_id: a.organizationId, type: 'facture', client_id: clientId,
    issue_date: '2026-01-01', due_date: '2026-01-31', notes: 'Brouillon E2E',
  }
  const created = await api('POST', '/rest/v1/documents?select=id', { token: a.token, headers: SINGLE, body: draftPayload })
  const draftId = created.json?.id
  check(created.status === 201 && UUID.test(draftId ?? ''), 'insert(...).select(\'id\').single() returns the id of the new draft', `HTTP ${created.status}`)
  check(dbDocument(draftId) === 'draft|NULL|2026-01-01|2026-01-31|Brouillon E2E',
    'in the database it is a draft, without a number, with the dates exactly as sent', dbDocument(draftId))

  for (const [column, value] of [['status', 'sent'], ['number', 1], ['year', 2026]]) {
    const forbidden = await api('POST', '/rest/v1/documents?select=id', { token: a.token, headers: SINGLE, body: { ...draftPayload, [column]: value } })
    check(forbidden.status === 403 && forbidden.json?.code === '42501',
      `A cannot insert a document with ${column} = ${JSON.stringify(value)} (42501)`, `HTTP ${forbidden.status}, code ${forbidden.json?.code}`)
  }
  const statusUpdate = await api('PATCH', onePath(a.organizationId, draftId), { token: a.token, headers: SINGLE, body: { status: 'sent' } })
  check(statusUpdate.status === 403 && statusUpdate.json?.code === '42501', 'A cannot update the status of a draft either (42501)',
    `HTTP ${statusUpdate.status}, code ${statusUpdate.json?.code}`)
  const count = psql(`select count(*) from public.documents where organization_id = '${a.organizationId}';`)
  check(count === '1', 'none of the refused inserts left a row', `documents of A: ${count}`)

  // 3. The list, as the app asks for it -------------------------------------------------------
  console.log('\n[3] A lists the documents with the query of the app')
  const list = await api('GET', listPath(a.organizationId), { token: a.token })
  const row = list.json?.[0]
  check(list.status === 200 && list.json?.length === 1 && row?.id === draftId, 'the list returns the draft', `HTTP ${list.status}, rows: ${list.json?.length}`)
  check(row?.client?.name === 'Client E2E',
    'the client name is embedded through the composite foreign key (organization_id, client_id)', JSON.stringify(row?.client))
  check(row?.issue_date === '2026-01-01' && row?.due_date === '2026-01-31' && typeof row?.issue_date === 'string',
    'dates come back as the same "YYYY-MM-DD" strings', `${row?.issue_date} / ${row?.due_date}`)
  check(row?.status === 'draft' && row?.number === null && row?.year === null && row?.buyer_name === null,
    'a draft has no number, no year and no buyer snapshot')
  const filtered = await api('GET', `${listPath(a.organizationId)}&type=eq.devis&status=eq.draft`, { token: a.token })
  check(filtered.status === 200 && filtered.json?.length === 0, 'the type and status filters are applied by the database', `rows: ${filtered.json?.length}`)

  // 4. B -----------------------------------------------------------------------------------------
  console.log('\n[4] B cannot see, update or delete it')
  const foreignRead = await api('GET', onePath(a.organizationId, draftId, DETAIL), { token: b.token })
  check(foreignRead.status === 200 && foreignRead.json?.length === 0, 'B reading the document gets no row', `rows: ${foreignRead.json?.length}`)
  const foreignList = await api('GET', '/rest/v1/documents?select=id', { token: b.token })
  check(foreignList.json?.length === 0, 'B listing every document sees none', `rows: ${foreignList.json?.length}`)
  const foreignClients = await api('GET', '/rest/v1/clients?select=id', { token: b.token })
  check(foreignClients.json?.length === 0, 'B sees none of A\'s clients', `rows: ${foreignClients.json?.length}`)
  const foreignUpdate = await api('PATCH', onePath(a.organizationId, draftId), { token: b.token, headers: SINGLE, body: { notes: 'taken over' } })
  check(foreignUpdate.status === 406 && foreignUpdate.json?.code === 'PGRST116', 'B updating it: no row (PGRST116)',
    `HTTP ${foreignUpdate.status}, code ${foreignUpdate.json?.code}`)
  const foreignDelete = await api('DELETE', onePath(a.organizationId, draftId), { token: b.token, headers: SINGLE })
  check(foreignDelete.status === 406 && foreignDelete.json?.code === 'PGRST116', 'B deleting it: no row (PGRST116)',
    `HTTP ${foreignDelete.status}, code ${foreignDelete.json?.code}`)
  const foreignInsert = await api('POST', '/rest/v1/documents?select=id', { token: b.token, headers: SINGLE, body: draftPayload })
  check(foreignInsert.status === 403 && foreignInsert.json?.code === '42501', 'B cannot insert a document into A\'s organization (42501)',
    `HTTP ${foreignInsert.status}, code ${foreignInsert.json?.code}`)
  const crossClient = await api('POST', '/rest/v1/documents?select=id', {
    token: b.token, headers: SINGLE, body: { organization_id: b.organizationId, type: 'devis', client_id: clientId },
  })
  check(crossClient.status === 409 && crossClient.json?.code === '23503', 'B cannot use A\'s client in their own document (23503)',
    `HTTP ${crossClient.status}, code ${crossClient.json?.code}`)
  check(dbDocument(draftId) === 'draft|NULL|2026-01-01|2026-01-31|Brouillon E2E', 'after B\'s attempts the draft is unchanged', dbDocument(draftId))

  // 5. A edits and deletes drafts --------------------------------------------------------------
  console.log('\n[5] A updates the header of the draft, and deletes another draft')
  const update = await api('PATCH', onePath(a.organizationId, draftId), {
    token: a.token, headers: SINGLE, body: { client_id: clientId, issue_date: null, due_date: null, notes: 'Modifié' },
  })
  check(update.status === 200 && update.json?.id === draftId, 'update(...).select(\'id\').single() succeeds on a draft', `HTTP ${update.status}`)
  check(dbDocument(draftId) === 'draft|NULL|NULL|NULL|Modifié', 'the header is updated; empty dates are NULL', dbDocument(draftId))
  const badDates = await api('PATCH', onePath(a.organizationId, draftId), {
    token: a.token, headers: SINGLE, body: { issue_date: '2026-10-13', due_date: '2026-10-12' },
  })
  check(badDates.status === 400 && badDates.json?.code === '23514', 'a due date before the issue date is refused by the database too (23514)',
    `HTTP ${badDates.status}, code ${badDates.json?.code}`)

  const second = await api('POST', '/rest/v1/documents?select=id', { token: a.token, headers: SINGLE, body: { ...draftPayload, type: 'devis' } })
  const secondId = second.json?.id
  const removed = await api('DELETE', onePath(a.organizationId, secondId), { token: a.token, headers: SINGLE })
  check(removed.status === 200 && removed.json?.id === secondId, 'A deletes a draft: delete().select(\'id\').single() returns it', `HTTP ${removed.status}`)
  check(psql(`select count(*) from public.documents where id = '${secondId}';`) === '0', 'that draft is gone from the database')

  // 6. Once issued ---------------------------------------------------------------------------------
  console.log('\n[6] once issued by the real finalize_document(), the owner can no longer change it')
  const withoutLines = await api('POST', '/rest/v1/rpc/finalize_document', { token: a.token, body: { p_document_id: draftId } })
  check(withoutLines.status === 400 && withoutLines.json?.code === 'DF004', 'finalize refuses a document without lines (DF004)',
    `HTTP ${withoutLines.status}, code ${withoutLines.json?.code}`)
  const item = await api('POST', '/rest/v1/document_items', {
    token: a.token,
    body: { organization_id: a.organizationId, document_id: draftId, description: 'Ligne E2E', quantity: '1.000', unit_price: '10.000', tva_rate: '0.000' },
  })
  check(item.status === 201, 'A adds one line to the draft over REST', `HTTP ${item.status}`)
  const finalized = await api('POST', '/rest/v1/rpc/finalize_document', { token: a.token, body: { p_document_id: draftId } })
  check(finalized.status === 200 && finalized.json?.status === 'sent' && finalized.json?.number === 1,
    'finalize_document(), called by the owner, issues it: status sent, number 1', `HTTP ${finalized.status}, code ${finalized.json?.code ?? '-'}`)

  const issued = await api('GET', onePath(a.organizationId, draftId, DETAIL), { token: a.token })
  check(issued.json?.[0]?.status === 'sent' && issued.json?.[0]?.buyer_name === 'Client E2E' && typeof issued.json?.[0]?.year === 'number',
    'the detail query of the app reads it: sent, with the buyer snapshot', `status ${issued.json?.[0]?.status}, buyer ${issued.json?.[0]?.buyer_name}`)
  const before = dbDocument(draftId)

  const lateUpdate = await api('PATCH', onePath(a.organizationId, draftId), { token: a.token, headers: SINGLE, body: { notes: 'trop tard' } })
  check(lateUpdate.status === 406 && lateUpdate.json?.code === 'PGRST116', 'A updating the issued document: no row (PGRST116)',
    `HTTP ${lateUpdate.status}, code ${lateUpdate.json?.code}`)
  const lateUpdatePlain = await api('PATCH', onePath(a.organizationId, draftId), { token: a.token, headers: REPRESENTATION, body: { notes: 'trop tard' } })
  check(lateUpdatePlain.status === 200 && lateUpdatePlain.json?.length === 0,
    'the same UPDATE without .single() is NOT an error: 200 with 0 rows (why the app always asks for one object)',
    `HTTP ${lateUpdatePlain.status}, rows: ${lateUpdatePlain.json?.length}`)
  const lateDelete = await api('DELETE', onePath(a.organizationId, draftId), { token: a.token, headers: SINGLE })
  check(lateDelete.status === 406 && lateDelete.json?.code === 'PGRST116', 'A deleting the issued document: no row (PGRST116)',
    `HTTP ${lateDelete.status}, code ${lateDelete.json?.code}`)
  check(dbDocument(draftId) === before && before.startsWith('sent|1|'), 'the issued document is unchanged and still there', dbDocument(draftId))

  const listAfter = await api('GET', listPath(a.organizationId), { token: a.token })
  check(listAfter.json?.length === 1 && listAfter.json[0].status === 'sent' && listAfter.json[0].number === 1 && listAfter.json[0].buyer_name === 'Client E2E',
    'the list shows it as sent, with its number and the buyer snapshot', JSON.stringify({ status: listAfter.json?.[0]?.status, number: listAfter.json?.[0]?.number, year: listAfter.json?.[0]?.year }))
  const clientDelete = await api('DELETE', `/rest/v1/clients?id=eq.${clientId}&organization_id=eq.${a.organizationId}`, { token: a.token })
  check(clientDelete.status === 409 && clientDelete.json?.code === '23503', 'the client of a document cannot be deleted (23503)',
    `HTTP ${clientDelete.status}, code ${clientDelete.json?.code}`)
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
create temp table doomed_orgs on commit drop as
  select distinct organization_id as id from public.organization_members where user_id in (select id from doomed_users);
delete from public.payments where organization_id in (select id from doomed_orgs);
delete from public.document_items where organization_id in (select id from doomed_orgs);
delete from public.documents where organization_id in (select id from doomed_orgs);
delete from public.document_counters where organization_id in (select id from doomed_orgs);
delete from public.clients where organization_id in (select id from doomed_orgs);
delete from public.tax_settings where organization_id in (select id from doomed_orgs);
delete from public.organization_members where organization_id in (select id from doomed_orgs);
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
