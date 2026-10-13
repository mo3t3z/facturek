import { describe, expect, it } from 'vitest'
import {
  computeTotals,
  formatMillimes,
  fromDbNumeric,
  fromDbQuantity,
  fromDbRate,
  GROUP_SEPARATOR,
  type Line,
  lineTotalHT,
  MAX_MILLIMES,
  MAX_QTY_MILLI,
  MAX_RATE_MILLI,
  type Millimes,
  millimes,
  MoneyFormatError,
  MoneyRangeError,
  parseMillimes,
  parseQuantity,
  parseRate,
  qtyMilli,
  rateMilli,
  toDbNumeric,
  tvaByRate,
} from './money'
import source from './money.ts?raw'
import vectorFile from './vectors.json'

// --- vectors -----------------------------------------------------------------------------------
type Expected =
  | { error: string }
  | { lineTotals: string[]; tvaLines: string[][]; totalHT: string; totalTVA: string; totalTTC: string }
type Vector = { comment?: string; lines: string[][]; timbre: string | null; expected: Expected }

const handWritten = vectorFile.handWritten as Vector[]
const generated = vectorFile.generated.vectors as Vector[]

function toLines(vector: Vector): Line[] {
  return vector.lines.map(([quantity = '', unitPrice = '', rate = '']) => ({
    quantity: fromDbQuantity(quantity),
    unitPrice: fromDbNumeric(unitPrice),
    tvaRate: fromDbRate(rate),
  }))
}
const toTimbre = (vector: Vector) => (vector.timbre === null ? null : fromDbNumeric(vector.timbre))

/** Runs the module on a vector and prints the result in the form of the file. */
function actual(vector: Vector): Expected {
  try {
    const lines = toLines(vector)
    const totals = computeTotals({ lines, timbre: toTimbre(vector) })
    // The three public functions must tell the same story.
    expect(tvaByRate(lines)).toEqual(totals.tvaLines)
    expect(lines.map((line) => lineTotalHT(line.quantity, line.unitPrice))).toEqual(totals.lines.map((line) => line.totalHT))
    return {
      lineTotals: totals.lines.map((line) => toDbNumeric(line.totalHT)),
      tvaLines: totals.tvaLines.map((line) => [toDbNumeric(line.rate), toDbNumeric(line.baseHT), toDbNumeric(line.tva)]),
      totalHT: toDbNumeric(totals.totalHT),
      totalTVA: toDbNumeric(totals.totalTVA),
      totalTTC: toDbNumeric(totals.totalTTC),
    }
  } catch (error) {
    if (error instanceof MoneyRangeError) return { error: 'MoneyRangeError' }
    throw error
  }
}

describe('hand-written vectors', () => {
  it('cover the cases the plan lists', () => {
    expect(handWritten.length).toBeGreaterThanOrEqual(20)
    expect(handWritten.every((vector) => typeof vector.comment === 'string' && vector.comment.length > 20)).toBe(true)
    expect(handWritten.filter((vector) => 'error' in vector.expected).length).toBeGreaterThanOrEqual(5)
  })

  it.each(handWritten.map((vector) => [vector.comment, vector] as const))('%s', (_comment, vector) => {
    expect(actual(vector)).toEqual(vector.expected)
  })
})

describe('vectors generated with Postgres as the oracle', () => {
  it('are at least 500, from a fixed seed, and include totals over the maximum', () => {
    expect(vectorFile.generated.seed).toBe(20261013)
    expect(vectorFile.generated.oracle).toMatch(/^PostgreSQL /)
    expect(generated.length).toBe(vectorFile.generated.count)
    expect(generated.length).toBeGreaterThanOrEqual(500)
    expect(generated.filter((vector) => 'error' in vector.expected).length).toBeGreaterThan(10)
  })

  it('include bases whose product with the rate does not fit in a float (above 2^53)', () => {
    const beyondFloat = generated.filter(
      (vector) =>
        'tvaLines' in vector.expected &&
        vector.expected.tvaLines.some(([rate = '', base = '']) => BigInt(base.replace('.', '')) * BigInt(rate.replace('.', '')) > 2n ** 53n),
    )
    expect(beyondFloat.length).toBeGreaterThan(20)
  })

  it('all give exactly what Postgres computed', () => {
    const wrong = generated
      .map((vector, index) => ({ index, vector, got: actual(vector) }))
      .filter(({ vector, got }) => JSON.stringify(got) !== JSON.stringify(vector.expected))
    // Only the first disagreements are printed: enough to see what broke.
    expect(wrong.slice(0, 3)).toEqual([])
    expect(wrong.length).toBe(0)
  })
})

// --- parsers -----------------------------------------------------------------------------------
const ACCEPTED: [string, number][] = [
  ['12', 12000],
  ['12,5', 12500],
  ['12.500', 12500],
  ['12.5', 12500],
  ['12,50', 12500],
  ['0', 0],
  ['0,000', 0],
  ['0,001', 1],
  ['0.01', 10],
  ['007', 7000],
  ['  12,5  ', 12500],
  ['\t12\n', 12000],
  [' 12,5 ', 12500],
  ['100', 100000],
  ['99,999', 99999],
]

const REJECTED: [string, string][] = [
  ['empty', ''],
  ['spaces only', '   '],
  ['tab and newline only', '\t\n'],
  ['more than 3 decimals', '12,5000'],
  ['more than 3 decimals (point)', '0.0005'],
  ['negative', '-1'],
  ['negative zero', '-0'],
  ['plus sign', '+1'],
  ['exponent', '1e3'],
  ['exponent, upper case', '1E3'],
  ['exponent with decimals', '1.5e2'],
  ['thousands separator: space', '1 234'],
  ['thousands separator: no-break space', '1 234,5'],
  ['thousands separator: narrow no-break space', '1 234'],
  ['thousands separator: point then comma', '1.234,5'],
  ['thousands separator: comma then point', '1,234.5'],
  ['thousands separator: apostrophe', "1'234"],
  ['thousands separator: underscore', '1_234'],
  ['no digit before the separator (point)', '.5'],
  ['no digit before the separator (comma)', ',5'],
  ['no digit after the separator (point)', '12.'],
  ['no digit after the separator (comma)', '12,'],
  ['separator alone', ','],
  ['two commas', '12,5,5'],
  ['two points', '12.5.5'],
  ['doubled separator', '12,,5'],
  ['Arabic-Indic digits', '١٢'],
  ['Eastern Arabic-Indic digits', '۱۲٫۵'],
  ['full-width digits', '１２'],
  ['Arabic decimal separator', '12٫5'],
  ['letters', 'abc'],
  ['trailing letters', '12abc'],
  ['currency suffix', '12 TND'],
  ['hexadecimal', '0x10'],
  ['Infinity', 'Infinity'],
  ['NaN', 'NaN'],
  ['space inside', '12 ,5'],
  ['newline inside', '1\n2'],
]

describe.each([
  ['parseMillimes', parseMillimes],
  ['parseQuantity', parseQuantity],
  ['parseRate', parseRate],
] as const)('%s', (_name, parse) => {
  it.each(ACCEPTED)('accepts %j as %d thousandths', (text, expected) => {
    expect(parse(text)).toBe(expected)
  })

  it.each(REJECTED)('rejects %s: %j', (_reason, text) => {
    expect(parse(text)).toBeNull()
  })
})

describe('parser limits', () => {
  it('accepts the largest amount and quantity, and nothing above', () => {
    expect(parseMillimes('999999999.999')).toBe(MAX_MILLIMES)
    expect(parseMillimes('999999999,999')).toBe(MAX_MILLIMES)
    expect(parseMillimes('1000000000')).toBeNull()
    expect(parseMillimes('1000000000,000')).toBeNull()
    expect(parseQuantity('999999999.999')).toBe(MAX_QTY_MILLI)
    expect(parseQuantity('1000000000')).toBeNull()
  })

  it('does not lose digits on a very long number: it is simply too large', () => {
    expect(parseMillimes('9'.repeat(40))).toBeNull()
    expect(parseMillimes(`${'9'.repeat(40)},5`)).toBeNull()
    // 2^53 + 1 written out: a float would silently turn it into 2^53.
    expect(parseMillimes('9007199254740993')).toBeNull()
  })

  it('accepts a rate up to 100 % and nothing above', () => {
    expect(parseRate('100')).toBe(MAX_RATE_MILLI)
    expect(parseRate('100,000')).toBe(MAX_RATE_MILLI)
    expect(parseRate('100,001')).toBeNull()
    expect(parseRate('101')).toBeNull()
    expect(parseRate('19')).toBe(19000)
    expect(parseRate('0,5')).toBe(500)
  })
})

// --- constructors --------------------------------------------------------------------------------
describe.each([
  ['millimes', millimes, MAX_MILLIMES],
  ['qtyMilli', qtyMilli, MAX_QTY_MILLI],
  ['rateMilli', rateMilli, MAX_RATE_MILLI],
] as const)('%s', (_name, make, max) => {
  it('accepts whole numbers from 0 to its maximum', () => {
    expect(make(0)).toBe(0)
    expect(make(1)).toBe(1)
    expect(make(max)).toBe(max)
  })

  it.each([
    ['one above the maximum', max + 1],
    ['negative', -1],
    ['a fraction', 0.5],
    ['a fraction of a millime', 12.0001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['beyond the safe integers', 2 ** 53],
  ])('throws MoneyRangeError for %s', (_reason, value) => {
    expect(() => make(value)).toThrow(MoneyRangeError)
  })
})

describe('MoneyRangeError and MoneyFormatError', () => {
  it('are typed, named errors', () => {
    const range = new MoneyRangeError('x')
    expect(range).toBeInstanceOf(RangeError)
    expect(range).toBeInstanceOf(MoneyRangeError)
    expect(range.name).toBe('MoneyRangeError')
    const format = new MoneyFormatError('x')
    expect(format).toBeInstanceOf(Error)
    expect(format).not.toBeInstanceOf(MoneyRangeError)
    expect(format.name).toBe('MoneyFormatError')
  })
})

// --- database text -------------------------------------------------------------------------------
describe('fromDbNumeric / fromDbQuantity / fromDbRate', () => {
  it('read the text Postgres prints for a numeric with 3 decimals', () => {
    expect(fromDbNumeric('1234.500')).toBe(1234500)
    expect(fromDbNumeric('0.000')).toBe(0)
    expect(fromDbNumeric('0.001')).toBe(1)
    expect(fromDbNumeric('999999999.999')).toBe(MAX_MILLIMES)
    expect(fromDbQuantity('1.500')).toBe(1500)
    expect(fromDbQuantity('999999999.999')).toBe(MAX_QTY_MILLI)
    expect(fromDbRate('19.000')).toBe(19000)
    expect(fromDbRate('100.000')).toBe(MAX_RATE_MILLI)
  })

  it.each([
    ['empty', ''],
    ['no decimals', '1234'],
    ['two decimals', '1234.50'],
    ['four decimals', '1234.5000'],
    ['a comma', '1234,500'],
    ['surrounding spaces', ' 1234.500 '],
    ['negative', '-1.000'],
    ['plus sign', '+1.000'],
    ['leading zero', '01.000'],
    ['no leading digit', '.500'],
    ['exponent', '1e3'],
    ['exponent with 3 decimals', '1.000e3'],
    ['NaN, which numeric can hold', 'NaN'],
    ['a second number on another line', '1.000\n2.000'],
    ['non-ASCII digits', '١٢.٠٠٠'],
  ])('throw MoneyFormatError for %s: %j', (_reason, text) => {
    expect(() => fromDbNumeric(text)).toThrow(MoneyFormatError)
    expect(() => fromDbQuantity(text)).toThrow(MoneyFormatError)
    expect(() => fromDbRate(text)).toThrow(MoneyFormatError)
  })

  it('throw MoneyRangeError above the maximum of the type', () => {
    expect(() => fromDbNumeric('1000000000.000')).toThrow(MoneyRangeError)
    expect(() => fromDbQuantity('1000000000.000')).toThrow(MoneyRangeError)
    expect(() => fromDbRate('100.001')).toThrow(MoneyRangeError)
    expect(() => fromDbNumeric(`${'9'.repeat(30)}.000`)).toThrow(MoneyRangeError)
  })
})

describe('toDbNumeric', () => {
  it.each([
    [0, '0.000'],
    [1, '0.001'],
    [10, '0.010'],
    [999, '0.999'],
    [1000, '1.000'],
    [1234500, '1234.500'],
    [MAX_MILLIMES, '999999999.999'],
  ])('writes %d as %s', (value, text) => {
    expect(toDbNumeric(millimes(value))).toBe(text)
    expect(fromDbNumeric(text)).toBe(value)
  })

  it('writes quantities and rates the same way', () => {
    expect(toDbNumeric(qtyMilli(1500))).toBe('1.500')
    expect(toDbNumeric(rateMilli(19000))).toBe('19.000')
  })

  it('refuses a value that is not a valid amount, even if TypeScript was told otherwise', () => {
    expect(() => toDbNumeric(12.5 as Millimes)).toThrow(MoneyRangeError)
    expect(() => toDbNumeric(-1 as Millimes)).toThrow(MoneyRangeError)
    expect(() => toDbNumeric((MAX_MILLIMES + 1) as Millimes)).toThrow(MoneyRangeError)
  })
})

// --- display -------------------------------------------------------------------------------------
describe('formatMillimes', () => {
  const S = GROUP_SEPARATOR

  it('uses a no-break space, so an amount never wraps', () => {
    expect(S).toBe(' ')
  })

  it.each([
    [0, '0,000'],
    [1, '0,001'],
    [50, '0,050'],
    [999, '0,999'],
    [1000, '1,000'],
    [12500, '12,500'],
    [999999, '999,999'],
    [1000000, `1${S}000,000`],
    [1234500, `1${S}234,500`],
    [12345678, `12${S}345,678`],
    [123456789, `123${S}456,789`],
    [1234567890, `1${S}234${S}567,890`],
    [MAX_MILLIMES, `999${S}999${S}999,999`],
  ])('formats %d millimes as %s', (value, text) => {
    expect(formatMillimes(millimes(value))).toBe(text)
  })

  it('refuses a value that is not a valid amount', () => {
    expect(() => formatMillimes(0.5 as Millimes)).toThrow(MoneyRangeError)
    expect(() => formatMillimes(-1000 as Millimes)).toThrow(MoneyRangeError)
  })
})

// --- calculations ----------------------------------------------------------------------------------
const line = (quantity: number, unitPrice: number, rate: number): Line => ({
  quantity: qtyMilli(quantity),
  unitPrice: millimes(unitPrice),
  tvaRate: rateMilli(rate),
})

describe('lineTotalHT', () => {
  it.each([
    ['2 x 10.000', 2000, 10000, 20000],
    ['exactly half a millime goes up: 0.001 x 0.500', 1, 500, 1],
    ['just under half goes down: 0.001 x 0.499', 1, 499, 0],
    ['1.5 x 0.001 -> 0.002', 1500, 1, 2],
    ['2.5 x 0.001 -> 0.003 (half-even would say 0.002)', 2500, 1, 3],
    ['1.333 x 7.500 = 9.9975 -> 9.998', 1333, 7500, 9998],
    ['zero quantity', 0, 12345, 0],
    ['zero price', 5000, 0, 0],
    ['the maximum, exactly', 1000, MAX_MILLIMES, MAX_MILLIMES],
  ])('%s', (_label, quantity, unitPrice, expected) => {
    expect(lineTotalHT(qtyMilli(quantity), millimes(unitPrice))).toBe(expected)
  })

  it('throws MoneyRangeError when the result exceeds the maximum', () => {
    expect(() => lineTotalHT(qtyMilli(1001), millimes(MAX_MILLIMES))).toThrow(MoneyRangeError)
    expect(() => lineTotalHT(qtyMilli(MAX_QTY_MILLI), millimes(MAX_MILLIMES))).toThrow(MoneyRangeError)
  })

  it('refuses inputs that are not valid values, even if TypeScript was told otherwise', () => {
    expect(() => lineTotalHT(1.5 as never, millimes(1))).toThrow(MoneyRangeError)
    expect(() => lineTotalHT(qtyMilli(1), -1 as never)).toThrow(MoneyRangeError)
  })
})

describe('tvaByRate', () => {
  it('returns nothing for no lines', () => {
    expect(tvaByRate([])).toEqual([])
  })

  it('groups by rate, sums the bases and sorts by rate whatever the order of the lines', () => {
    const lines = [line(1000, 100000, 19000), line(2000, 50000, 7000), line(1000, 10000, 0), line(3000, 20000, 19000)]
    const expected = [
      { rate: 0, baseHT: 10000, tva: 0 },
      { rate: 7000, baseHT: 100000, tva: 7000 },
      { rate: 19000, baseHT: 160000, tva: 30400 },
    ]
    expect(tvaByRate(lines)).toEqual(expected)
    expect(tvaByRate([...lines].reverse())).toEqual(expected)
  })

  it('computes the TVA once per rate, not once per line', () => {
    const lines = [line(1000, 3, 19000), line(1000, 3, 19000), line(1000, 3, 19000)]
    // Per line: 0.00057 -> 0.001, three times = 0.003. Per rate: 0.009 x 19 % = 0.00171 -> 0.002.
    expect(tvaByRate(lines)).toEqual([{ rate: 19000, baseHT: 9, tva: 2 }])
  })

  it('rounds the TVA half-up', () => {
    expect(tvaByRate([line(1000, 50, 19000)])).toEqual([{ rate: 19000, baseHT: 50, tva: 10 }]) // 0.0095
    expect(tvaByRate([line(1000, 1000, 50)])).toEqual([{ rate: 50, baseHT: 1000, tva: 1 }]) // 0.0005
    expect(tvaByRate([line(1000, 1000, 49)])).toEqual([{ rate: 49, baseHT: 1000, tva: 0 }]) // 0.00049
  })

  it('is exact when base x rate does not fit in a float', () => {
    // 829999968999 x 19001 = 15770829410949999 > 2^53. A float gives ...110.
    expect(tvaByRate([line(1000, 829999968999, 19001)])).toEqual([{ rate: 19001, baseHT: 829999968999, tva: 157708294109 }])
  })

  it('throws MoneyRangeError when a base exceeds the maximum', () => {
    expect(() => tvaByRate([line(1000, 500000000000, 0), line(1000, 500000000000, 0)])).toThrow(MoneyRangeError)
  })

  it('refuses a rate that is not a valid rate, even if TypeScript was told otherwise', () => {
    expect(() => tvaByRate([{ ...line(1000, 1000, 0), tvaRate: 100001 as never }])).toThrow(MoneyRangeError)
    expect(() => tvaByRate([{ ...line(1000, 1000, 0), tvaRate: 19.5 as never }])).toThrow(MoneyRangeError)
  })
})

describe('computeTotals', () => {
  it('gives zeros for no lines, and keeps the timbre as given', () => {
    expect(computeTotals({ lines: [], timbre: null })).toEqual({
      lines: [],
      tvaLines: [],
      totalHT: 0,
      totalTVA: 0,
      timbre: null,
      totalTTC: 0,
    })
    expect(computeTotals({ lines: [], timbre: millimes(600) })).toMatchObject({ totalHT: 0, totalTVA: 0, timbre: 600, totalTTC: 600 })
  })

  it('returns each line with its total, in the order given', () => {
    const lines = [line(2000, 10000, 19000), line(1333, 7500, 7000)]
    const totals = computeTotals({ lines, timbre: null })
    expect(totals.lines).toEqual([
      { ...lines[0], totalHT: 20000 },
      { ...lines[1], totalHT: 9998 },
    ])
  })

  it('adds HT, TVA and the timbre; the timbre is not subject to TVA', () => {
    const totals = computeTotals({ lines: [line(2000, 10000, 19000)], timbre: millimes(1000) })
    expect(totals).toMatchObject({ totalHT: 20000, totalTVA: 3800, timbre: 1000, totalTTC: 24800 })
  })

  it('does not change its input', () => {
    const lines = Object.freeze([Object.freeze(line(1000, 1000, 19000)), Object.freeze(line(1000, 1000, 0))])
    const input = Object.freeze({ lines, timbre: null })
    expect(() => computeTotals(input)).not.toThrow()
  })

  it.each([
    ['a line', { lines: [line(2000, MAX_MILLIMES, 0)], timbre: null }],
    ['the sum of the lines', { lines: [line(1000, 500000000000, 0), line(1000, 500000000000, 0)], timbre: null }],
    ['HT + TVA', { lines: [line(1000, 900000000000, 19000)], timbre: null }],
    ['the timbre on top of the maximum', { lines: [line(1000, MAX_MILLIMES, 0)], timbre: millimes(1) }],
  ])('throws MoneyRangeError when %s exceeds the maximum', (_what, input) => {
    expect(() => computeTotals(input)).toThrow(MoneyRangeError)
  })

  it('refuses a timbre that is not a valid amount, even if TypeScript was told otherwise', () => {
    expect(() => computeTotals({ lines: [], timbre: -1 as Millimes })).toThrow(MoneyRangeError)
    expect(() => computeTotals({ lines: [], timbre: 0.5 as Millimes })).toThrow(MoneyRangeError)
  })
})

// --- rules on the source itself -----------------------------------------------------------------
describe('source rules for src/lib/money', () => {
  // Comments are removed first: they are allowed to name what the code must not use.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('imports nothing: no React, no Supabase, no i18n', () => {
    expect(code).not.toMatch(/\bimport\b/)
    expect(code).not.toMatch(/\brequire\s*\(/)
    expect(code).not.toMatch(/react|supabase|i18n/i)
  })

  it('never goes through a float: no parseFloat, parseInt, toFixed, Math or Intl', () => {
    expect(code).not.toMatch(/parseFloat|parseInt|toFixed|toPrecision|toLocaleString/)
    expect(code).not.toMatch(/\bMath\./)
    expect(code).not.toMatch(/\bIntl\./)
  })

  it('converts with Number(...) in exactly one place, and only from a bigint', () => {
    expect(code.match(/\bNumber\(/g)).toHaveLength(1)
    expect(code).toMatch(/function toNumber\(exact: bigint\): number \{\s*return Number\(exact\)\s*\}/)
    // The unary plus is the other way to turn a string into a float.
    expect(code).not.toMatch(/[=(,:?]\s*\+[a-zA-Z('"`]/)
  })

  it('contains no tax value', () => {
    // The only numbers in the code are scales (1000, 100 000), the limits and 0 / 2 / 3 / 4.
    const numbers = [...code.matchAll(/\b[0-9][0-9_]*n?\b/g)].map(([value]) => value.replace(/_/g, '').replace(/n$/, ''))
    expect([...new Set(numbers)].sort()).toEqual(['0', '1', '1000', '100000', '2', '3', '4', '9', '999999999999'])
  })
})
