// Concurrency test for public.finalize_document().
//
// pgTAP runs in ONE database session, so it cannot prove anything about two users
// finalizing at the same moment. This script opens many REAL connections (one psql process
// per connection, through `docker exec` into the local Supabase database container) and
// makes them call finalize_document() at the same instant.
//
// It only ever talks to the LOCAL database container. No dependency: Node + Docker.
//
//   npm run test:concurrency
//   CONCURRENCY_WORKERS=50 npm run test:concurrency
//
// What it checks
//   1. N drafts of the same organization / type / year finalized in parallel receive
//      exactly the numbers 1..N: no duplicate, no gap, no failed call.
//   2. A finalize inside a transaction that is rolled back consumes no number.
//   3. The same draft finalized from several connections at once is finalized exactly once.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const WORKERS = Number(process.env.CONCURRENCY_WORKERS ?? 20)
const SAME_DOCUMENT_CALLERS = 5
// Each worker keeps its transaction open this long after finalizing, so the transactions
// are guaranteed to overlap instead of finishing before the next one starts.
const HOLD_SECONDS = 0.1

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1]
if (!projectId) throw new Error('project_id not found in supabase/config.toml')
const container = `supabase_db_${projectId}`

/** Runs SQL in a new psql process = a new database connection. */
function openPsql() {
  const child = spawn(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { child, done }
}

async function runSql(sql) {
  const { child, done } = openPsql()
  child.stdin.end(sql)
  return done
}

async function mustRunSql(sql) {
  const result = await runSql(sql)
  if (result.code !== 0) throw new Error(`psql failed (exit ${result.code}):\n${result.stderr}`)
  return result.stdout.trim()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------
// Fixture: one organization, one user (owner), one client, and the drafts to finalize.
// ---------------------------------------------------------------------------------------
const runId = randomUUID().slice(0, 8)
const userId = randomUUID()
const orgId = randomUUID()
const clientId = randomUUID()
const parallelDocs = Array.from({ length: WORKERS }, () => randomUUID())
const rollbackDoc = randomUUID()
const afterRollbackDoc = randomUUID()
const sameDoc = randomUUID()
const allDocs = [...parallelDocs, rollbackDoc, afterRollbackDoc, sameDoc]
// Session-level advisory lock used as a starting gun (must fit in 31 bits).
const gunKey = 700000000 + Math.floor(Math.random() * 1000000)

const setupSql = `
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '${userId}', 'authenticated', 'authenticated',
        'concurrency-${runId}@test.local', '', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.profiles (id, full_name) values ('${userId}', 'Concurrency test')
  on conflict (id) do nothing;
insert into public.organizations (id, name) values ('${orgId}', 'Concurrency test ${runId}');
insert into public.organization_members (organization_id, user_id, role)
  values ('${orgId}', '${userId}', 'owner');
insert into public.tax_settings (organization_id) values ('${orgId}');
insert into public.clients (id, organization_id, name) values ('${clientId}', '${orgId}', 'Client');
insert into public.documents (id, organization_id, type, client_id)
  values ${allDocs.map((id) => `('${id}', '${orgId}', 'facture', '${clientId}')`).join(',\n         ')};
insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
  select organization_id, id, 'Line', 1, 1, 0 from public.documents where organization_id = '${orgId}';
commit;
`

// Deleting the organization cascades to members, tax_settings, clients and counters.
const cleanupSql = `
begin;
delete from public.payments where organization_id = '${orgId}';
delete from public.documents where organization_id = '${orgId}';
delete from public.organizations where id = '${orgId}';
delete from auth.users where id = '${userId}';
commit;
`

/** SQL run by one API user: same role and JWT claims PostgREST sets for a real request. */
function asUser(body) {
  return `
begin;
select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
set local role authenticated;
${body}
`
}

function finalizeAndCommit(documentId) {
  return asUser(`
select 'NUMBER=' || number from public.finalize_document('${documentId}');
select pg_sleep(${HOLD_SECONDS});
commit;
`)
}

/**
 * Starts one connection per SQL script, parks them all on a shared advisory lock, and
 * releases them together once every connection is waiting.
 */
async function runTogether(scripts) {
  const gun = openPsql()
  gun.child.stdin.write(`select pg_advisory_lock(${gunKey});\n`)

  // The gun must be loaded before any worker arrives, or workers would run straight through.
  const gunDeadline = Date.now() + 30000
  for (;;) {
    const held = Number(await mustRunSql(
      `select count(*) from pg_locks where locktype = 'advisory' and objid = ${gunKey} and granted;`,
    ))
    if (held === 1) break
    if (Date.now() > gunDeadline) throw new Error('the starting lock was never acquired')
    await sleep(100)
  }

  const workers = scripts.map((sql) => {
    const worker = openPsql()
    worker.child.stdin.end(
      `select pg_advisory_lock_shared(${gunKey});\nselect pg_advisory_unlock_shared(${gunKey});\n${sql}`,
    )
    return worker.done
  })

  // Wait until every worker is connected and blocked on the starting gun.
  const deadline = Date.now() + 60000
  for (;;) {
    const waiting = Number(await mustRunSql(
      `select count(*) from pg_locks where locktype = 'advisory' and objid = ${gunKey} and not granted;`,
    ))
    if (waiting === scripts.length) break
    if (Date.now() > deadline) throw new Error(`only ${waiting}/${scripts.length} workers reached the start line`)
    await sleep(100)
  }

  // While the workers run, sample how many sessions are blocked waiting for a lock.
  let peakLockWaiters = 0
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      const result = await runSql(
        `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%finalize_document%' and pid <> pg_backend_pid();`,
      )
      if (result.code === 0) peakLockWaiters = Math.max(peakLockWaiters, Number(result.stdout.trim()))
    }
  })()

  const startedAt = Date.now()
  gun.child.stdin.end(`select pg_advisory_unlock(${gunKey});\n`)
  const results = await Promise.all(workers)
  const elapsedMs = Date.now() - startedAt
  sampling = false
  await sampler
  await gun.done
  return { results, peakLockWaiters, elapsedMs }
}

const numberOf = (stdout) => {
  const match = /^NUMBER=(\d+)$/m.exec(stdout)
  return match ? Number(match[1]) : null
}
const errorOf = (stderr) => (/ERROR:\s+(.*)/.exec(stderr)?.[1] ?? stderr.trim().split('\n')[0] ?? '').trim()

const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

async function seriesState() {
  const out = await mustRunSql(`
select coalesce((select string_agg(number::text, ',' order by number)
                 from public.documents where organization_id = '${orgId}' and number is not null), '');
select coalesce((select string_agg(last_number::text, ',') from public.document_counters
                 where organization_id = '${orgId}'), '');
`)
  const [numbers = '', counter = ''] = out.split('\n')
  return { numbers: numbers ? numbers.split(',').map(Number) : [], counter }
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1)
const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i])

// ---------------------------------------------------------------------------------------
console.log(`Database container: ${container} (local)`)
await mustRunSql(setupSql)
console.log(`Fixture created: organization ${orgId}, ${allDocs.length} draft factures\n`)

try {
  // 1. N different drafts, N connections, same instant ----------------------------------
  console.log(`[1] ${WORKERS} connections finalize ${WORKERS} different drafts at the same instant`)
  const parallel = await runTogether(parallelDocs.map(finalizeAndCommit))
  const failed = parallel.results.filter((r) => r.code !== 0)
  const returned = parallel.results.map((r) => numberOf(r.stdout)).filter((n) => n !== null).sort((a, b) => a - b)
  console.log(`      elapsed ${parallel.elapsedMs} ms, peak sessions blocked on a lock: ${parallel.peakLockWaiters}`)
  check(failed.length === 0, `all ${WORKERS} calls succeeded`,
    failed.length ? `${failed.length} failed, first error: ${errorOf(failed[0].stderr)}` : '')
  check(sameList(returned, range(WORKERS)), `the returned numbers are exactly 1..${WORKERS}`,
    `returned: ${returned.join(',')}`)
  check(new Set(returned).size === returned.length, 'no number was returned twice')
  let state = await seriesState()
  check(sameList(state.numbers, range(WORKERS)), `the stored numbers are exactly 1..${WORKERS} (no duplicate, no gap)`,
    `stored: ${state.numbers.join(',')}`)
  check(state.counter === String(WORKERS), `the counter is ${WORKERS}`, `counter: ${state.counter || '(no row)'}`)
  check(parallel.peakLockWaiters > 0, 'the calls really overlapped (some had to wait for a lock)')

  // 2. A rolled back finalize consumes no number ----------------------------------------
  console.log('\n[2] finalize inside a transaction that is rolled back')
  const rolledBack = await runSql(asUser(`
select 'NUMBER=' || number from public.finalize_document('${rollbackDoc}');
rollback;
`))
  check(rolledBack.code === 0 && numberOf(rolledBack.stdout) === WORKERS + 1,
    `inside the transaction the document received number ${WORKERS + 1}`,
    rolledBack.code === 0 ? `returned: ${numberOf(rolledBack.stdout)}` : errorOf(rolledBack.stderr))
  const afterRollback = await mustRunSql(
    `select status || '/' || coalesce(number::text, 'null') from public.documents where id = '${rollbackDoc}';`,
  )
  check(afterRollback === 'draft/null', 'after ROLLBACK the document is a draft without a number again',
    `status/number: ${afterRollback}`)
  state = await seriesState()
  check(state.counter === String(WORKERS), `after ROLLBACK the counter is back to ${WORKERS}`, `counter: ${state.counter}`)
  const next = await runSql(finalizeAndCommit(afterRollbackDoc))
  check(next.code === 0 && numberOf(next.stdout) === WORKERS + 1,
    `the next committed finalize receives ${WORKERS + 1}: the rolled back call left no gap`,
    next.code === 0 ? `returned: ${numberOf(next.stdout)}` : errorOf(next.stderr))

  // 3. The same draft from several connections at once -----------------------------------
  console.log(`\n[3] ${SAME_DOCUMENT_CALLERS} connections finalize the SAME draft at the same instant`)
  const same = await runTogether(Array.from({ length: SAME_DOCUMENT_CALLERS }, () => finalizeAndCommit(sameDoc)))
  const winners = same.results.filter((r) => r.code === 0)
  const losers = same.results.filter((r) => r.code !== 0)
  check(winners.length === 1, 'exactly one call succeeded', `succeeded: ${winners.length}`)
  check(losers.length === SAME_DOCUMENT_CALLERS - 1 && losers.every((r) => /DF002/.test(r.stderr)),
    `the other ${SAME_DOCUMENT_CALLERS - 1} were rejected with DF002 (document is not a draft)`,
    losers.length ? `first error: ${errorOf(losers[0].stderr)}` : '')
  state = await seriesState()
  check(sameList(state.numbers, range(WORKERS + 2)), `the series is exactly 1..${WORKERS + 2}: only one number was consumed`,
    `stored: ${state.numbers.join(',')}`)
  check(state.counter === String(WORKERS + 2), `the counter is ${WORKERS + 2}`, `counter: ${state.counter}`)
} finally {
  const cleanup = await runSql(cleanupSql)
  console.log(cleanup.code === 0
    ? '\nFixture removed.'
    : `\nWARNING: cleanup failed, test data for organization ${orgId} is still in the LOCAL database:\n${cleanup.stderr}`)
}

console.log(failures.length === 0
  ? '\nRESULT: PASS'
  : `\nRESULT: FAIL (${failures.length} check${failures.length > 1 ? 's' : ''} failed)`)
process.exit(failures.length === 0 ? 0 : 1)
