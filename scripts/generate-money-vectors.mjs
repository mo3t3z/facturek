// Generates the random test vectors of src/lib/money/vectors.json, with POSTGRES as the
// oracle: the expected values are computed by the local database with numeric arithmetic,
// independently of the TypeScript module they are used to test.
//
//   npm run money:vectors      (needs the local database: npm run db:start)
//
// What it does
//   * Builds VECTOR_COUNT random documents from a fixed seed (same seed = same file).
//   * Asks Postgres, in ONE read-only SELECT over a VALUES list (no table is read or
//     written), for: round(quantity * unit_price, 3) per line; per rate, the sum of those
//     line totals and round(base * rate / 100, 3); the totals; and whether the TTC exceeds
//     numeric(12,3).
//   * Re-checks the hand-written vectors of the file against the same query and FAILS if
//     one of them disagrees with Postgres. It never rewrites them.
//   * Rewrites only the "generated" section. Vitest then reads the file offline.
//
// Rates and timbre amounts below are random test data, not tax values.
// No dependency: `docker exec psql`, like the other scripts.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SEED = 20261013
const VECTOR_COUNT = 600
const FILE = 'src/lib/money/vectors.json'
const MAX = '999999999.999'

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1]
if (!projectId) throw new Error('project_id not found in supabase/config.toml')
const container = `supabase_db_${projectId}`

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.status !== 0) throw new Error(`psql failed:\n${result.stderr}`)
  return result.stdout
}

// --- deterministic random numbers (mulberry32) ---------------------------------------------
let state = SEED >>> 0
function random() {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
/** Whole number in [min, max]. */
const int = (min, max) => min + Math.floor(random() * (max - min + 1))
const pick = (list) => list[int(0, list.length - 1)]
/** A whole number of thousandths -> "123.456". Built from integers only. */
const text = (thousandths) => {
  const digits = String(thousandths).padStart(4, '0')
  return `${digits.slice(0, -3)}.${digits.slice(-3)}`
}

const COMMON_RATES = [0, 7000, 13000, 19000]

/**
 * A base (in millimes) such that base x rate ends in ...49999: one unit under a tie, and
 * past 2^53. A float cannot hold that odd product; it becomes ...50000, a tie that is not
 * one. The rate must share no factor with 100000 (odd, not a multiple of 5).
 */
function baseOneUnderATie(rate) {
  let inverse = 1n
  while ((inverse * BigInt(rate)) % 100000n !== 1n) inverse += 1n
  const residue = Number((49999n * inverse) % 100000n)
  return int(4800000, 8000000) * 100000 + residue
}
const awkwardRate = () => {
  let rate = int(19001, 23999)
  while (rate % 2 === 0 || rate % 5 === 0) rate += 1
  return rate
}
const anyRate = () => int(0, 100000)
const timbre = () => (random() < 0.5 ? null : text(pick([0, 600, 1000, int(1, 5000)])))

// Seven families, so every kind of difficulty is well represented.
const families = [
  // everyday documents: whole quantities, usual rates
  () => Array.from({ length: int(1, 6) }, () => [text(int(1, 50) * 1000), text(int(0, 2000000)), text(pick(COMMON_RATES))]),
  // quantities and prices with 3 decimals
  () => Array.from({ length: int(1, 6) }, () => [text(int(1, 99999)), text(int(1, 999999)), text(pick(COMMON_RATES))]),
  // tiny values: many products land on or next to half a millime
  () => Array.from({ length: int(1, 8) }, () => [text(int(1, 9999)), text(pick([5, 50, 500, 250, 125, int(1, 999)])), text(anyRate())]),
  // several arbitrary rates with 3 decimals
  () => Array.from({ length: int(2, 8) }, () => [text(int(1, 20000)), text(int(0, 500000)), text(pick([anyRate(), anyRate(), 19000, 500, 50]))]),
  // very large amounts: base x rate goes above 2^53, and some totals exceed numeric(12,3)
  // (480 000 000 TND x 19 % is already past it); one in three gets a second large line.
  () => [
    [text(1000), text(int(480000000000, 800000000000)), text(int(19000, 24000))],
    ...(random() < 0.33 ? [[text(int(1, 3000)), text(int(100000000000, 400000000000)), text(pick([0, 19000]))]] : []),
  ],
  // one large line whose TVA is one unit under a tie, past 2^53 (see baseOneUnderATie)
  () => {
    const rate = awkwardRate()
    return [[text(1000), text(baseOneUnderATie(rate)), text(rate)]]
  },
  // edge mix: zero prices, zero rates, repeated rates
  () => Array.from({ length: int(1, 5) }, () => [text(int(1, 5000)), text(pick([0, 0, 1, int(0, 100000)])), text(pick([0, 0, 19000, 7000]))]),
]

const generated = Array.from({ length: VECTOR_COUNT }, (_, index) => ({
  lines: families[index % families.length](),
  timbre: timbre(),
}))

// --- the oracle --------------------------------------------------------------------------------
const file = JSON.parse(readFileSync(FILE, 'utf8'))
const all = [...file.handWritten, ...generated]

const NUMBER = /^(0|[1-9][0-9]*)\.[0-9]{3}$/
const sqlNumber = (value) => {
  if (!NUMBER.test(value)) throw new Error(`not a plain number: ${value}`)
  return `${value}::numeric`
}
const documentRows = all.map((vector, v) => `(${v}, ${vector.timbre === null ? 'null::numeric' : sqlNumber(vector.timbre)})`)
const lineRows = all.flatMap((vector, v) =>
  vector.lines.map(([quantity, unitPrice, rate], n) => `(${v}, ${n}, ${sqlNumber(quantity)}, ${sqlNumber(unitPrice)}, ${sqlNumber(rate)})`),
)

const oracleSql = `
with document(v, timbre) as (values ${documentRows.join(',\n')}),
line(v, n, quantity, unit_price, rate) as (values ${lineRows.join(',\n')}),
line_total as (
  select v, n, rate, round(quantity * unit_price, 3) as total from line
),
rate_total as (
  select v, rate, sum(total) as base, round(sum(total) * rate / 100, 3) as tva
  from line_total group by v, rate
),
total as (
  select d.v, d.timbre,
         coalesce((select sum(r.base) from rate_total r where r.v = d.v), 0.000) as ht,
         coalesce((select sum(r.tva) from rate_total r where r.v = d.v), 0.000) as tva
  from document d
)
select t.v || E'\\t' || json_build_object(
  'over', (t.ht + t.tva + coalesce(t.timbre, 0)) > ${MAX},
  'lineTotals', coalesce((select json_agg(l.total::text order by l.n) from line_total l where l.v = t.v), '[]'::json),
  'tvaLines', coalesce((select json_agg(json_build_array(round(r.rate, 3)::text, r.base::text, r.tva::text) order by r.rate)
                        from rate_total r where r.v = t.v), '[]'::json),
  'totalHT', round(t.ht, 3)::text,
  'totalTVA', round(t.tva, 3)::text,
  'totalTTC', round(t.ht + t.tva + coalesce(t.timbre, 0), 3)::text
)::text
from total t order by t.v;
`

const answers = new Map(
  psql(oracleSql)
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t')
      return [Number(row.slice(0, tab)), JSON.parse(row.slice(tab + 1))]
    }),
)
if (answers.size !== all.length) throw new Error(`expected ${all.length} answers from Postgres, got ${answers.size}`)

function expectedFrom(answer) {
  if (answer.over) return { error: 'MoneyRangeError' }
  const { lineTotals, tvaLines, totalHT, totalTVA, totalTTC } = answer
  return { lineTotals, tvaLines, totalHT, totalTVA, totalTTC }
}

// --- hand-written vectors must agree with Postgres --------------------------------------------
const disagreements = file.handWritten
  .map((vector, v) => ({ vector, postgres: expectedFrom(answers.get(v)) }))
  .filter(({ vector, postgres }) => JSON.stringify(vector.expected) !== JSON.stringify(postgres))
if (disagreements.length > 0) {
  for (const { vector, postgres } of disagreements) {
    console.log(`HAND-WRITTEN VECTOR DISAGREES WITH POSTGRES\n  ${vector.comment}\n  file:     ${JSON.stringify(vector.expected)}\n  postgres: ${JSON.stringify(postgres)}`)
  }
  process.exit(1)
}

// --- write the file ------------------------------------------------------------------------------
const vectors = generated.map((vector, index) => ({ ...vector, expected: expectedFrom(answers.get(file.handWritten.length + index)) }))
const oracle = psql('select version();').trim().split(' ').slice(0, 2).join(' ')
const output = [
  '{',
  `  "format": ${JSON.stringify(file.format)},`,
  '  "handWritten": [',
  file.handWritten.map((vector) => `    ${JSON.stringify(vector)}`).join(',\n'),
  '  ],',
  `  "generated": {"seed":${SEED},"count":${vectors.length},"oracle":${JSON.stringify(oracle)},"vectors":[`,
  vectors.map((vector) => `    ${JSON.stringify(vector)}`).join(',\n'),
  '  ]}',
  '}',
  '',
].join('\n')
writeFileSync(FILE, output)

const errors = vectors.filter((vector) => 'error' in vector.expected).length
console.log(`${file.handWritten.length} hand-written vectors agree with Postgres.`)
console.log(`${vectors.length} generated vectors written to ${FILE} (seed ${SEED}, oracle ${oracle}): ${vectors.length - errors} with totals, ${errors} over the maximum.`)
