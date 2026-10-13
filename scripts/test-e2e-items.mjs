// End-to-end test of the LINES of a document through the REAL local stack: Supabase Auth,
// PostgREST, RLS, the column privileges and the guard triggers, exactly as the browser
// reaches them (anon key + the user's token). It proves what the mocked component tests
// cannot:
//   * quantities, prices and rates go in as text and come back as the same text (::text),
//     including the edge values (0.001, 1234567.891, 7.5, 0);
//   * another user can neither see, insert, update nor delete the lines;
//   * once the document is issued by the real finalize_document(), its owner can no longer
//     insert, update or delete a line (the exact answers are printed);
//   * computeTotals() of src/lib/money, run on the lines read through the API, gives
//     exactly what Postgres computes on the same rows with the rounding rule of the vector
//     generator (round(quantity * unit_price, 3) per line, round(base * rate / 100, 3)
//     once per rate). The compared numbers are printed.
//
//   npm run test:e2e-items      (needs the local stack: npm run db:start)
//
// The money module is TypeScript: this script is started with Node's own
// --experimental-strip-types (no dependency), which is why it can import it directly.
//
// Rules of this script (same as test-e2e-documents.mjs)
//   * LOCAL ONLY: it refuses to run unless the URL reported by the CLI is on localhost.
//   * The keys are read from `supabase status` at runtime and are NEVER printed. Neither
//     are tokens or passwords.
//   * No dependency: Node's fetch + `docker exec psql`.
//   * The two throwaway users sign up through the real Auth API. Their e-mail is then
//     confirmed with one UPDATE of those two auth.users rows, by id.
//   * Cleanup removes the users of this run, selected by their exact addresses, and what
//     belongs to their organizations. Triggers are off for that ONE cleanup transaction
//     (SET LOCAL): an issued document and the last owner of an organization cannot be
//     deleted by any role otherwise. Nothing else is touched.
//   * The quantities, prices and rates below are test data, not tax values.

import { execSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { computeTotals, fromDbNumeric, fromDbQuantity, fromDbRate, toDbNumeric } from '../src/lib/money/money.ts'

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
const emailA = `e2e-items-a-${runId}@test.local`
const emailB = `e2e-items-b-${runId}@test.local`
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

// The same columns, filters and order as src/features/documents/itemsApi.ts.
const ITEMS = 'id,position,description,quantity::text,unit_price::text,tva_rate::text'
const itemsPath = (organizationId, documentId) =>
  `/rest/v1/document_items?select=${ITEMS}&organization_id=eq.${organizationId}&document_id=eq.${documentId}&order=position,created_at,id&limit=1000`
const itemPath = (organizationId, documentId, itemId) =>
  `/rest/v1/document_items?select=id&organization_id=eq.${organizationId}&document_id=eq.${documentId}&id=eq.${itemId}`
// What supabase-js sends for .single(): "exactly one object, or it is an error".
const SINGLE = { Accept: 'application/vnd.pgrst.object+json', Prefer: 'return=representation' }
const outcome = (response) => `HTTP ${response.status}, code ${response.json?.code ?? '-'}`
const dbItems = (documentId) =>
  psql(`select coalesce(string_agg(description || '=' || quantity::text || 'x' || unit_price::text || '@' || tva_rate::text, ' ; ' order by position), '(none)') from public.document_items where document_id = '${documentId}';`)

console.log(`Local API: ${apiUrl}\n`)

try {
  console.log('[1] two throwaway users sign up through the Auth API')
  const a = await createUser(emailA, 'E2E Items A')
  const b = await createUser(emailB, 'E2E Items B')
  check(a.organizationId !== b.organizationId, 'each user got an organization of their own')

  const client = await api('POST', '/rest/v1/clients?select=id', { token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, name: 'Client E2E' } })
  const draft = await api('POST', '/rest/v1/documents?select=id', {
    token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, type: 'facture', client_id: client.json?.id },
  })
  const documentId = draft.json?.id
  check(draft.status === 201 && UUID.test(documentId ?? ''), 'A has a draft facture', outcome(draft))

  // 2. Lines in, lines out --------------------------------------------------------------------
  console.log('\n[2] A adds lines with the payload of the app; numerics go in and come back as text')
  // Edge values: the smallest quantity, a price with 3 decimals and 10 digits, a rate with a
  // decimal, a zero rate, a zero price, and three tiny lines that round differently per line and per rate.
  const lines = [
    { description: 'Petite quantité', quantity: '0.001', unit_price: '1234567.891', tva_rate: '7.500' },
    { description: 'Sans TVA', quantity: '3.000', unit_price: '19.990', tva_rate: '0.000' },
    { description: 'Gratuit', quantity: '2.500', unit_price: '0.000', tva_rate: '19.000' },
    { description: 'Demi-millime 1', quantity: '0.001', unit_price: '0.500', tva_rate: '19.000' },
    { description: 'Demi-millime 2', quantity: '1.000', unit_price: '0.003', tva_rate: '19.000' },
    { description: 'Demi-millime 3', quantity: '1.000', unit_price: '0.003', tva_rate: '19.000' },
    { description: 'Grande ligne', quantity: '1234.567', unit_price: '9876.543', tva_rate: '13.000' },
  ]
  const ids = []
  for (const [position, line] of lines.entries()) {
    const inserted = await api('POST', '/rest/v1/document_items?select=id', {
      token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, document_id: documentId, position, ...line },
    })
    if (inserted.status !== 201) throw new Error(`insert of "${line.description}" failed: ${outcome(inserted)}`)
    ids.push(inserted.json.id)
  }
  check(ids.length === lines.length && ids.every((id) => UUID.test(id)), `insert(...).select('id').single() returned an id for each of the ${lines.length} lines`)

  const read = await api('GET', itemsPath(a.organizationId, documentId), { token: a.token })
  const stored = read.json ?? []
  check(read.status === 200 && stored.length === lines.length, 'the list query of the app returns them', `HTTP ${read.status}, rows: ${stored.length}`)
  const sameValues = stored.every((row, index) =>
    row.description === lines[index].description && row.quantity === lines[index].quantity &&
    row.unit_price === lines[index].unit_price && row.tva_rate === lines[index].tva_rate)
  check(sameValues, 'every value comes back exactly as it was sent')
  for (const row of stored.slice(0, 3)) console.log(`      ${row.description}: quantity "${row.quantity}", unit_price "${row.unit_price}", tva_rate "${row.tva_rate}"`)
  check(stored.every((row) => ['quantity', 'unit_price', 'tva_rate'].every((column) => typeof row[column] === 'string')),
    'quantity, unit_price and tva_rate are JSON strings (read with ::text)')
  check(read.text.includes('"quantity":"0.001"') && read.text.includes('"unit_price":"1234567.891"') && read.text.includes('"tva_rate":"7.500"') && read.text.includes('"tva_rate":"0.000"'),
    'the raw body has quantity 0.001, price 1234567.891, rate 7.500 and rate 0.000 in quotes, with 3 decimals')

  const shortForm = await api('PATCH', itemPath(a.organizationId, documentId, ids[0]), { token: a.token, headers: SINGLE, body: { tva_rate: '7.5' } })
  const reread = await api('GET', itemsPath(a.organizationId, documentId), { token: a.token })
  check(shortForm.status === 200 && reread.json?.[0]?.tva_rate === '7.500', 'a rate sent as "7.5" is stored and returned as "7.500"', `returned: ${reread.json?.[0]?.tva_rate}`)

  for (const [label, body] of [
    ['a zero quantity', { quantity: '0.000' }], ['a negative price', { unit_price: '-1.000' }],
    ['a rate above 100', { tva_rate: '100.001' }], ['a blank description', { description: '   ' }],
  ]) {
    const refused = await api('PATCH', itemPath(a.organizationId, documentId, ids[1]), { token: a.token, headers: SINGLE, body })
    check(refused.status === 400 && refused.json?.code === '23514', `${label} is refused by the database (23514)`, outcome(refused))
  }
  const moved = await api('PATCH', itemPath(a.organizationId, documentId, ids[1]), { token: a.token, headers: SINGLE, body: { document_id: documentId } })
  check(moved.status === 403 && moved.json?.code === '42501', 'document_id is not a column the API role may update (42501)', outcome(moved))

  // 3. B ---------------------------------------------------------------------------------------
  console.log('\n[3] B cannot see, insert, update or delete A\'s lines')
  const before = dbItems(documentId)
  const foreignRead = await api('GET', itemsPath(a.organizationId, documentId), { token: b.token })
  check(foreignRead.status === 200 && foreignRead.json?.length === 0, 'B reading the lines gets no row', `rows: ${foreignRead.json?.length}`)
  const foreignAll = await api('GET', '/rest/v1/document_items?select=id', { token: b.token })
  check(foreignAll.json?.length === 0, 'B listing every line sees none', `rows: ${foreignAll.json?.length}`)
  const foreignInsert = await api('POST', '/rest/v1/document_items?select=id', {
    token: b.token, headers: SINGLE, body: { organization_id: a.organizationId, document_id: documentId, position: 99, ...lines[0] },
  })
  check(foreignInsert.status === 403 && foreignInsert.json?.code === '42501', 'B inserting a line into A\'s document: 42501', outcome(foreignInsert))
  const smuggled = await api('POST', '/rest/v1/document_items?select=id', {
    token: b.token, headers: SINGLE, body: { organization_id: b.organizationId, document_id: documentId, position: 99, ...lines[0] },
  })
  // The RLS policy looks for a draft with that id in B's own organization and finds none,
  // so it refuses the row before the composite foreign key is even checked.
  check(smuggled.status === 403 && smuggled.json?.code === '42501', 'B naming their own organization with A\'s document: 42501 as well', outcome(smuggled))
  const foreignUpdate = await api('PATCH', itemPath(a.organizationId, documentId, ids[0]), { token: b.token, headers: SINGLE, body: { description: 'taken over' } })
  check(foreignUpdate.status === 406 && foreignUpdate.json?.code === 'PGRST116', 'B updating a line: no row (PGRST116)', outcome(foreignUpdate))
  const foreignDelete = await api('DELETE', itemPath(a.organizationId, documentId, ids[0]), { token: b.token, headers: SINGLE })
  check(foreignDelete.status === 406 && foreignDelete.json?.code === 'PGRST116', 'B deleting a line: no row (PGRST116)', outcome(foreignDelete))
  check(dbItems(documentId) === before, 'after B\'s attempts the lines are unchanged in the database')

  // 4. A edits and removes a line ---------------------------------------------------------------
  console.log('\n[4] A updates and deletes a line of the draft')
  const extra = await api('POST', '/rest/v1/document_items?select=id', {
    token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, document_id: documentId, position: 50, description: 'En trop', quantity: '1.000', unit_price: '1.000', tva_rate: '0.000' },
  })
  const update = await api('PATCH', itemPath(a.organizationId, documentId, extra.json?.id), {
    token: a.token, headers: SINGLE, body: { description: 'En trop (modifiée)', quantity: '2.000', unit_price: '1.500', tva_rate: '7.000' },
  })
  check(update.status === 200 && update.json?.id === extra.json?.id, 'update(...).select(\'id\').single() succeeds on a line of a draft', outcome(update))
  const removed = await api('DELETE', itemPath(a.organizationId, documentId, extra.json?.id), { token: a.token, headers: SINGLE })
  check(removed.status === 200 && removed.json?.id === extra.json?.id, 'delete().select(\'id\').single() removes it', outcome(removed))
  check(dbItems(documentId) === before, 'the document is back to its seven lines')

  // 5. TypeScript and Postgres agree ---------------------------------------------------------
  console.log('\n[5] computeTotals (src/lib/money) against Postgres, on the lines stored in the database')
  const fromApp = (await api('GET', itemsPath(a.organizationId, documentId), { token: a.token })).json
  const totals = computeTotals({
    lines: fromApp.map((row) => ({ quantity: fromDbQuantity(row.quantity), unitPrice: fromDbNumeric(row.unit_price), tvaRate: fromDbRate(row.tva_rate) })),
    timbre: null,
  })
  const typescript = {
    lineTotals: totals.lines.map((line) => toDbNumeric(line.totalHT)),
    tvaLines: totals.tvaLines.map((line) => [toDbNumeric(line.rate), toDbNumeric(line.baseHT), toDbNumeric(line.tva)]),
    totalHT: toDbNumeric(totals.totalHT),
    totalTVA: toDbNumeric(totals.totalTVA),
    totalTTC: toDbNumeric(totals.totalTTC),
  }
  // The same expressions as scripts/generate-money-vectors.mjs: round(quantity * unit_price, 3)
  // per line; per rate, the sum of those and round(base * rate / 100, 3). Read-only.
  const postgres = JSON.parse(psql(`
with line_total as (
  select position, tva_rate as rate, round(quantity * unit_price, 3) as total
  from public.document_items where organization_id = '${a.organizationId}' and document_id = '${documentId}'
),
rate_total as (
  select rate, sum(total) as base, round(sum(total) * rate / 100, 3) as tva from line_total group by rate
)
select json_build_object(
  'lineTotals', (select json_agg(total::text order by position) from line_total),
  'tvaLines', (select json_agg(json_build_array(round(rate, 3)::text, base::text, tva::text) order by rate) from rate_total),
  'totalHT', (select round(sum(base), 3)::text from rate_total),
  'totalTVA', (select round(sum(tva), 3)::text from rate_total),
  'totalTTC', (select round(sum(base) + sum(tva), 3)::text from rate_total)
)::text;`))
  console.log(`      line totals   TypeScript: ${typescript.lineTotals.join(' | ')}`)
  console.log(`                    Postgres:   ${postgres.lineTotals.join(' | ')}`)
  for (const [index, row] of postgres.tvaLines.entries()) {
    const mine = typescript.tvaLines[index] ?? []
    console.log(`      rate ${row[0]} %  Postgres: base ${row[1]}, TVA ${row[2]}   TypeScript: base ${mine[1]}, TVA ${mine[2]}`)
  }
  console.log(`      total HT  ${typescript.totalHT} / ${postgres.totalHT}   total TVA  ${typescript.totalTVA} / ${postgres.totalTVA}   total TTC  ${typescript.totalTTC} / ${postgres.totalTTC}   (TypeScript / Postgres)`)
  check(JSON.stringify(typescript.lineTotals) === JSON.stringify(postgres.lineTotals), 'the line totals are identical')
  check(JSON.stringify(typescript.tvaLines) === JSON.stringify(postgres.tvaLines), 'the base and the TVA of each rate are identical')
  check(typescript.totalHT === postgres.totalHT && typescript.totalTVA === postgres.totalTVA && typescript.totalTTC === postgres.totalTTC,
    'total HT, total TVA and total TTC are identical')
  check(typescript.lineTotals[3] === '0.001' && typescript.tvaLines.find((row) => row[0] === '19.000')?.[2] === '0.001',
    'the tie cases behave as designed: 0.0005 rounds up per line, and the 19 % TVA is rounded once on the base 0.007',
    `line 4: ${typescript.lineTotals[3]}, 19 %: base ${typescript.tvaLines.find((row) => row[0] === '19.000')?.[1]}, TVA ${typescript.tvaLines.find((row) => row[0] === '19.000')?.[2]}`)

  // 6. Once issued -------------------------------------------------------------------------------
  console.log('\n[6] after the real finalize_document(), A can no longer insert, update or delete lines')
  const finalized = await api('POST', '/rest/v1/rpc/finalize_document', { token: a.token, body: { p_document_id: documentId } })
  check(finalized.status === 200 && finalized.json?.status === 'sent', 'finalize_document(), called by the owner, issues the facture', outcome(finalized))
  const lateInsert = await api('POST', '/rest/v1/document_items?select=id', {
    token: a.token, headers: SINGLE, body: { organization_id: a.organizationId, document_id: documentId, position: 99, ...lines[1] },
  })
  check(lateInsert.status === 400 && lateInsert.json?.code === 'DF014', 'A inserting a line: refused by the guard trigger', `observed: ${outcome(lateInsert)}`)
  const lateUpdate = await api('PATCH', itemPath(a.organizationId, documentId, ids[1]), { token: a.token, headers: SINGLE, body: { description: 'trop tard' } })
  check(lateUpdate.status === 406 && lateUpdate.json?.code === 'PGRST116', 'A updating a line: no row (RLS filters it out)', `observed: ${outcome(lateUpdate)}`)
  const lateDelete = await api('DELETE', itemPath(a.organizationId, documentId, ids[1]), { token: a.token, headers: SINGLE })
  check(lateDelete.status === 406 && lateDelete.json?.code === 'PGRST116', 'A deleting a line: no row (RLS filters it out)', `observed: ${outcome(lateDelete)}`)
  const latePlain = await api('DELETE', itemPath(a.organizationId, documentId, ids[1]), { token: a.token, headers: { Prefer: 'return=representation' } })
  check(latePlain.status === 200 && latePlain.json?.length === 0, 'the same DELETE without .single() is NOT an error: 200 with 0 rows', `observed: HTTP ${latePlain.status}, rows: ${latePlain.json?.length}`)
  check(dbItems(documentId) === before, 'the lines of the issued facture are unchanged in the database')
  const stillReadable = await api('GET', itemsPath(a.organizationId, documentId), { token: a.token })
  check(stillReadable.json?.length === lines.length, 'A can still read them', `rows: ${stillReadable.json?.length}`)
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
