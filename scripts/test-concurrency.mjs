// Concurrency test for public.finalize_document(), the item guard trigger and
// public.ensure_my_account().
//
// pgTAP runs in ONE database session, so it cannot prove anything about two users
// acting at the same moment. This script opens many REAL connections (one psql process
// per connection, through `docker exec` into the local Supabase database container) and
// releases them at the same instant.
//
// It only ever talks to the LOCAL database container. No dependency: Node + Docker.
//
//   npm run test:concurrency
//   CONCURRENCY_WORKERS=50 npm run test:concurrency
//
// What it checks
//   0. A signup (one INSERT into auth.users, as Supabase Auth does) gives the user exactly
//      one profile, one organization, one owner membership and one tax_settings row.
//   1. N drafts of the same organization / type / year finalized in parallel receive
//      exactly the numbers 1..N: no duplicate, no gap, no failed call.
//   2. A finalize inside a transaction that is rolled back consumes no number.
//   3. The same draft finalized from several connections at once is finalized exactly once.
//   4. Items inserted into a draft WHILE it is being finalized are either part of the
//      finalized document or rejected; none is stored after the fact.
//   5. The last item deleted WHILE the document is being finalized: either the finalize
//      fails (no items) or the delete fails; a sent document never ends up with no items.
//   6. ensure_my_account() called from several connections at once for a user without an
//      organization creates exactly ONE organization and ONE membership.
//
// session_replication_role = replica (switches triggers off for one transaction) is used
// in exactly two places, both documented where they happen, and ONLY because the target is
// the local test database. Never do this against a real database.
//   * Fixture: two users are created without the signup trigger firing, to reproduce a
//     signup whose provisioning failed (scenario 6 needs users with no organization).
//   * Cleanup: issued documents, payments and the last owner of an organization cannot be
//     deleted by any role (that is the point of the guard triggers), so the test data can
//     only be removed with the triggers off.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const WORKERS = Number(process.env.CONCURRENCY_WORKERS ?? 20)
const SAME_DOCUMENT_CALLERS = 5
const ITEM_INSERTERS = 15
const DELETE_RACE_ROUNDS = 9
const ENSURE_CALLERS = 5
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
// Fixture.
//   * The main user signs up exactly as through Supabase Auth: one INSERT into auth.users.
//     The on_auth_user_created trigger creates the profile, the organization, the owner
//     membership and the tax settings. Scenarios 1 to 5 run in that organization, so the
//     script also proves the signup path end to end.
//   * Two "orphan" users have NO organization, for scenario 6. They are inserted with
//     `SET LOCAL session_replication_role = replica` so that the signup trigger does not
//     fire: that reproduces a signup whose provisioning failed. One has no profile either;
//     the other already has a profile row (scenario 6 explains why both are needed).
// ---------------------------------------------------------------------------------------
const runId = randomUUID().slice(0, 8)
const userId = randomUUID()
const orphanWithoutProfile = randomUUID()
const orphanWithProfile = randomUUID()
const allUsers = [userId, orphanWithoutProfile, orphanWithProfile]
const clientId = randomUUID()
const parallelDocs = Array.from({ length: WORKERS }, () => randomUUID())
const rollbackDoc = randomUUID()
const afterRollbackDoc = randomUUID()
const sameDoc = randomUUID()
const itemRaceDoc = randomUUID()
const deleteRaceDocs = Array.from({ length: DELETE_RACE_ROUNDS }, () => randomUUID())
const allDocs = [...parallelDocs, rollbackDoc, afterRollbackDoc, sameDoc, itemRaceDoc, ...deleteRaceDocs]
// Session-level advisory lock used as a starting gun (must fit in 31 bits).
const gunKey = 700000000 + Math.floor(Math.random() * 1000000)
// Created by the signup trigger; read back after the signup.
let orgId = null

const authUserColumns = `(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, created_at, updated_at)`
const authUserRow = (id, label) => `('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
        'concurrency-${label}-${runId}@test.local', '', now(),
        '{"provider":"email","providers":["email"]}', '{"full_name":"Concurrency ${label}"}', now(), now())`

const signupSql = `insert into auth.users ${authUserColumns} values ${authUserRow(userId, 'main')};`

// LOCAL TEST DATABASE ONLY: triggers are switched off for this one transaction so the two
// users are created WITHOUT the signup trigger provisioning them.
const orphanUsersSql = `
begin;
set local session_replication_role = replica;
insert into auth.users ${authUserColumns}
values ${authUserRow(orphanWithoutProfile, 'orphan-a')},
       ${authUserRow(orphanWithProfile, 'orphan-b')};
insert into public.profiles (id, full_name) values ('${orphanWithProfile}', 'Concurrency orphan-b');
commit;
`

const documentsSql = () => `
begin;
insert into public.clients (id, organization_id, name) values ('${clientId}', '${orgId}', 'Client');
insert into public.documents (id, organization_id, type, client_id)
  values ${allDocs.map((id) => `('${id}', '${orgId}', 'facture', '${clientId}')`).join(',\n         ')};
insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
  select organization_id, id, 'Line', 1, 1, 0 from public.documents where organization_id = '${orgId}';
commit;
`

// LOCAL TEST DATABASE ONLY. With session_replication_role = replica, triggers do not fire
// for this transaction: neither our guard triggers (which rightly refuse to delete issued
// documents, payments or the last owner of an organization) nor the foreign-key triggers.
// So nothing cascades and every table is emptied explicitly, children first. The
// organizations to remove are found through the test users' memberships, which also covers
// any organization a failing scenario created by mistake. SET LOCAL ends with the transaction.
const userList = allUsers.map((id) => `'${id}'`).join(', ')
const cleanupSql = `
begin;
set local session_replication_role = replica;
create temp table doomed_orgs on commit drop as
  select distinct m.organization_id as id from public.organization_members m where m.user_id in (${userList});
delete from public.payments where organization_id in (select id from doomed_orgs);
delete from public.document_items where organization_id in (select id from doomed_orgs);
delete from public.documents where organization_id in (select id from doomed_orgs);
delete from public.document_counters where organization_id in (select id from doomed_orgs);
delete from public.clients where organization_id in (select id from doomed_orgs);
delete from public.tax_settings where organization_id in (select id from doomed_orgs);
delete from public.organization_members where organization_id in (select id from doomed_orgs);
delete from public.organizations where id in (select id from doomed_orgs);
delete from public.profiles where id in (${userList});
delete from auth.users where id in (${userList});
commit;
`

/** SQL run by one API user: same role and JWT claims PostgREST sets for a real request. */
function asUser(body, actingUserId = userId) {
  return `
begin;
select set_config('request.jwt.claims', '{"sub":"${actingUserId}","role":"authenticated"}', true);
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

// Everything from here on is inside try/finally so the fixture is removed even on failure.
try {
  // 0. Signup: one INSERT into auth.users, the trigger does the rest ---------------------
  console.log('[0] signup: one INSERT into auth.users, the trigger provisions the account')
  await mustRunSql(signupSql)
  const [profileCount, ownerCount, taxCount, organizationIds = ''] = (await mustRunSql(`
select count(*) from public.profiles where id = '${userId}';
select count(*) from public.organization_members where user_id = '${userId}' and role = 'owner';
select count(*) from public.tax_settings t
  join public.organization_members m on m.organization_id = t.organization_id where m.user_id = '${userId}';
select coalesce(string_agg(organization_id::text, ','), '') from public.organization_members where user_id = '${userId}';
`)).split('\n')
  check(profileCount === '1' && ownerCount === '1' && taxCount === '1' && !organizationIds.includes(',') && organizationIds !== '',
    'the signup created exactly one profile, one organization with the user as owner, and one tax_settings row',
    `profiles: ${profileCount}, owner memberships: ${ownerCount}, tax_settings: ${taxCount}`)
  if (failures.length > 0) throw new Error('signup did not provision the account; the other scenarios cannot run')
  orgId = organizationIds
  await mustRunSql(documentsSql())
  await mustRunSql(orphanUsersSql)
  console.log(`      organization ${orgId}, ${allDocs.length} draft factures, 2 users without an organization\n`)

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

  // 4. Items inserted while the document is being finalized ------------------------------
  // Inserter i starts i * 20 ms after the gun; the finalizer starts after 100 ms and keeps
  // its transaction open 300 ms. So some inserts land before the finalize and the others
  // arrive while it is in progress.
  console.log(`\n[4] ${ITEM_INSERTERS} connections insert items into a draft while another connection finalizes it`)
  const insertItem = (i) => `
select pg_sleep(${(i * 0.02).toFixed(2)});
${asUser(`
insert into public.document_items (organization_id, document_id, description, quantity, unit_price, tva_rate)
values ('${orgId}', '${itemRaceDoc}', 'race ${i}', 1, 1, 0);
select 'INSERTED';
commit;
`)}`
  const finalizeWhileInserting = `
select pg_sleep(0.1);
${asUser(`
select 'NUMBER=' || number from public.finalize_document('${itemRaceDoc}');
select pg_sleep(0.3);
select 'COUNTED=' || count(*) from public.document_items where document_id = '${itemRaceDoc}';
commit;
`)}`
  const itemRace = await runTogether([
    finalizeWhileInserting,
    ...Array.from({ length: ITEM_INSERTERS }, (_, i) => insertItem(i)),
  ])
  const [itemFinalizer, ...inserters] = itemRace.results
  const countedAtFinalize = Number(/^COUNTED=(\d+)$/m.exec(itemFinalizer.stdout)?.[1] ?? NaN)
  const inserted = inserters.filter((r) => r.code === 0 && /^INSERTED$/m.test(r.stdout))
  const rejected = inserters.filter((r) => r.code !== 0)
  const wronglyRejected = rejected.filter((r) => !/DF014/.test(r.stderr))
  const [itemDocStatus, itemsStored] = (await mustRunSql(`
select status from public.documents where id = '${itemRaceDoc}';
select count(*) from public.document_items where document_id = '${itemRaceDoc}';
`)).split('\n')
  console.log(`      inserted before the finalize: ${inserted.length}, rejected: ${rejected.length}, items counted inside the finalizing transaction: ${countedAtFinalize}, items stored now: ${itemsStored}`)
  check(itemFinalizer.code === 0 && itemDocStatus === 'sent', 'the finalize succeeded',
    itemFinalizer.code === 0 ? `status: ${itemDocStatus}` : errorOf(itemFinalizer.stderr))
  check(Number(itemsStored) === countedAtFinalize,
    'the document holds exactly the items it had when it was finalized (nothing slipped in afterwards)',
    `at finalize: ${countedAtFinalize}, now: ${itemsStored}`)
  check(Number(itemsStored) === 1 + inserted.length, 'every stored item is the initial one or an insert that reported success',
    `1 initial + ${inserted.length} successful inserts, stored: ${itemsStored}`)
  check(inserted.length + rejected.length === ITEM_INSERTERS && wronglyRejected.length === 0,
    'every insert that lost the race was rejected with DF014, none was silently dropped or stored',
    wronglyRejected.length ? `unexpected error: ${errorOf(wronglyRejected[0].stderr)}` : '')
  check(inserted.length > 0 && rejected.length > 0, 'both outcomes were observed (some inserts before, some during the finalize)',
    `inserted: ${inserted.length}, rejected: ${rejected.length}`)

  // 5. The last item deleted while the document is being finalized -----------------------
  // Several rounds, each with a fresh draft holding exactly one item. The round number
  // decides who starts first: the delete, the finalize, or both at the same instant.
  console.log(`\n[5] ${DELETE_RACE_ROUNDS} rounds: one connection deletes the last item while another finalizes`)
  const outcomes = { finalizeWon: 0, deleteWon: 0 }
  const violations = []
  for (let round = 0; round < DELETE_RACE_ROUNDS; round++) {
    const doc = deleteRaceDocs[round]
    const order = ['delete first', 'finalize first', 'same instant'][round % 3]
    const deleteDelay = order === 'finalize first' ? 0.05 : 0
    const finalizeDelay = order === 'delete first' ? 0.05 : 0
    const finalizeLast = `
select pg_sleep(${finalizeDelay});
${asUser(`
select 'NUMBER=' || number from public.finalize_document('${doc}');
select pg_sleep(0.15);
commit;
`)}`
    const deleteLast = `
select pg_sleep(${deleteDelay});
${asUser(`
with gone as (delete from public.document_items where document_id = '${doc}' returning 1)
select 'DELETED=' || count(*) from gone;
select pg_sleep(0.15);
commit;
`)}`
    const { results: [finalizer, deleter] } = await runTogether([finalizeLast, deleteLast])
    const finalized = finalizer.code === 0 && numberOf(finalizer.stdout) !== null
    const deletedRows = deleter.code === 0 ? Number(/^DELETED=(\d+)$/m.exec(deleter.stdout)?.[1] ?? NaN) : 0
    const stateNow = await mustRunSql(
      `select status || '/' || (select count(*) from public.document_items where document_id = '${doc}') from public.documents where id = '${doc}';`,
    )
    const finalizeWon = finalized && stateNow === 'sent/1' && deletedRows === 0
      && (deleter.code === 0 || /DF014/.test(deleter.stderr))
    const deleteWon = !finalized && /DF004/.test(finalizer.stderr) && stateNow === 'draft/0' && deletedRows === 1
    if (finalizeWon) outcomes.finalizeWon++
    else if (deleteWon) outcomes.deleteWon++
    else {
      violations.push(`round ${round + 1} (${order}): document is ${stateNow} (status/items); finalize ${finalized ? 'succeeded' : `failed: ${errorOf(finalizer.stderr)}`}; delete ${deleter.code === 0 ? `removed ${deletedRows} row(s)` : `failed: ${errorOf(deleter.stderr)}`}`)
    }
  }
  console.log(`      finalize won (delete rejected): ${outcomes.finalizeWon}, delete won (finalize failed with DF004): ${outcomes.deleteWon}`)
  const sentWithoutItems = await mustRunSql(`
select count(*) from public.documents d
where d.organization_id = '${orgId}' and d.status <> 'draft'
  and not exists (select 1 from public.document_items i where i.document_id = d.id);
`)
  check(sentWithoutItems === '0', 'no issued document is left without items', `issued documents with zero items: ${sentWithoutItems}`)
  check(violations.length === 0,
    'every round ended in one of the two valid outcomes (finalize fails with DF004, or the delete is rejected)',
    violations.join('\n      '))
  check(outcomes.finalizeWon > 0 && outcomes.deleteWon > 0, 'both outcomes were observed',
    `finalize won: ${outcomes.finalizeWon}, delete won: ${outcomes.deleteWon}`)

  // 6. ensure_my_account() called several times at once ---------------------------------
  // Two kinds of user without an organization:
  //   (a) no profile either. Here even without the advisory lock the calls are serialized
  //       by accident: they all insert the same profile primary key, and the losers wait
  //       for the winner to commit before they look at the memberships.
  //   (b) a profile already exists. Nothing serializes the calls except the advisory lock
  //       in provision_account(): this is the case that proves the lock is needed.
  console.log(`\n[6] ${ENSURE_CALLERS} connections call ensure_my_account() at the same instant for a user without an organization`)
  for (const [label, orphan] of [
    ['(a) user with no profile', orphanWithoutProfile],
    ['(b) user who already has a profile', orphanWithProfile],
  ]) {
    const call = asUser(`
select 'ORG=' || public.ensure_my_account();
select pg_sleep(${HOLD_SECONDS});
commit;
`, orphan)
    const { results: ensureResults } = await runTogether(Array.from({ length: ENSURE_CALLERS }, () => call))
    const ensureFailed = ensureResults.filter((r) => r.code !== 0)
    const returnedOrganizations = new Set(
      ensureResults.map((r) => /^ORG=(\S+)$/m.exec(r.stdout)?.[1]).filter(Boolean),
    )
    const [memberships, organizations, profiles, taxRows] = (await mustRunSql(`
select count(*) from public.organization_members where user_id = '${orphan}';
select count(distinct organization_id) from public.organization_members where user_id = '${orphan}';
select count(*) from public.profiles where id = '${orphan}';
select count(*) from public.tax_settings t
  join public.organization_members m on m.organization_id = t.organization_id where m.user_id = '${orphan}';
`)).split('\n').map(Number)
    check(ensureFailed.length === 0, `${label}: all ${ENSURE_CALLERS} calls succeeded`,
      ensureFailed.length ? `${ensureFailed.length} failed, first error: ${errorOf(ensureFailed[0].stderr)}` : '')
    check(organizations === 1 && memberships === 1, `${label}: exactly ONE organization and ONE membership exist afterwards`,
      `organizations: ${organizations}, memberships: ${memberships}`)
    check(returnedOrganizations.size === 1, `${label}: every call returned the same organization id`,
      `distinct organization ids returned: ${returnedOrganizations.size}`)
    check(profiles === 1 && taxRows === 1, `${label}: one profile and one tax_settings row`,
      `profiles: ${profiles}, tax_settings: ${taxRows}`)
  }
} catch (error) {
  // A scenario could not run at all (not a failed check): report it and still clean up.
  console.log(`\nABORTED: ${error.message}`)
  failures.push('aborted')
} finally {
  const cleanup = await runSql(cleanupSql)
  console.log(cleanup.code === 0
    ? '\nFixture removed.'
    : `\nWARNING: cleanup failed, test data of run ${runId} is still in the LOCAL database (npm run db:reset removes it):\n${cleanup.stderr}`)
}

console.log(failures.length === 0
  ? '\nRESULT: PASS'
  : `\nRESULT: FAIL (${failures.length} check${failures.length > 1 ? 's' : ''} failed)`)
process.exit(failures.length === 0 ? 0 : 1)
