// Money calculations for devis and factures. Pure functions: no React, no Supabase, no
// i18n, no import at all. Nothing here knows a tax value: every rate and the timbre are
// given by the caller (they come from tax_settings and from the document lines).
//
// UNITS: everything is an integer.
//   Millimes   amount x 1000      1 TND = 1000 millimes          12.500 TND -> 12500
//   QtyMilli   quantity x 1000    1.5 unit = 1500
//   RateMilli  percent x 1000     19 % = 19000, 0.5 % = 500
// The largest amount is the largest value of the database type numeric(12,3):
// 999 999 999.999 TND = 999_999_999_999 millimes. A result above it throws MoneyRangeError.
// No negative amount exists in this module: quantities, prices, rates, the timbre and every
// result are >= 0 (a correction will be a credit note, a separate document, later).
//
// ROUNDING RULE (option B of docs/phase2-plan.md), half-up to the millime:
//   1. line total HT = quantity x unit price, rounded to the millime, per line;
//   2. for each TVA rate: base HT = sum of the (already rounded) line totals of that rate;
//      TVA = base HT x rate / 100, rounded to the millime ONCE per rate, not per line;
//   3. total HT = sum of the bases, total TVA = sum of the TVA of each rate,
//      total TTC = total HT + total TVA + timbre. Nothing is rounded again in step 3.
// "Half-up": exactly half a millime goes up (0.0005 -> 0.001). With no negative amount this
// is what Postgres round(numeric, 3) does, so SQL and TypeScript agree on every tie.
// TODO(accountant): have this rule (per-rate TVA, half-up, timbre added after TVA and not
// subject to it) verified by an accountant before real use.
//
// WHY bigint inside: base x rate reaches about 1e17, above 2^53 (about 9e15), where a
// JavaScript number can no longer hold every integer. All arithmetic is done in bigint and
// converted back only after the range check. Values enter and leave as plain integers.

type Brand<Name extends string> = number & { readonly __brand: Name }
/** An amount in millimes: a whole number between 0 and MAX_MILLIMES. */
export type Millimes = Brand<'Millimes'>
/** A quantity x 1000: a whole number between 0 and MAX_QTY_MILLI. */
export type QtyMilli = Brand<'QtyMilli'>
/** A percentage x 1000: a whole number between 0 and MAX_RATE_MILLI (100 %). */
export type RateMilli = Brand<'RateMilli'>

/** numeric(12,3): 999 999 999.999 */
export const MAX_MILLIMES = 999_999_999_999
/** numeric(12,3): 999 999 999.999 */
export const MAX_QTY_MILLI = 999_999_999_999
/** numeric(6,3) with CHECK (between 0 and 100): 100.000 % */
export const MAX_RATE_MILLI = 100_000

/** Non-breaking space between groups of three digits, so an amount never wraps. */
export const GROUP_SEPARATOR = ' '

/** A value or a result is outside what numeric(12,3) (or a rate) can hold. */
export class MoneyRangeError extends RangeError {
  override name = 'MoneyRangeError'
}

/** A text coming from the database does not have the Postgres numeric form. */
export class MoneyFormatError extends Error {
  override name = 'MoneyFormatError'
}

export type Line = {
  readonly quantity: QtyMilli
  readonly unitPrice: Millimes
  readonly tvaRate: RateMilli
}
export type LineTotal = Line & { readonly totalHT: Millimes }
export type TvaLine = { readonly rate: RateMilli; readonly baseHT: Millimes; readonly tva: Millimes }
export type Totals = {
  readonly lines: readonly LineTotal[]
  /** One entry per rate present in the lines (rate 0 included), sorted by rate. */
  readonly tvaLines: readonly TvaLine[]
  readonly totalHT: Millimes
  readonly totalTVA: Millimes
  /** As given: null when no timbre applies. */
  readonly timbre: Millimes | null
  readonly totalTTC: Millimes
}

// --- internals ---------------------------------------------------------------------------

const MAX_MILLIMES_BIG = BigInt(MAX_MILLIMES)

function checked(value: number, max: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new MoneyRangeError(`${what} must be a whole number between 0 and ${max}`)
  }
  return value
}

/** The only place a bigint becomes a number again; callers have checked the range. */
function toNumber(exact: bigint): number {
  return Number(exact)
}

/** A calculated amount, back to Millimes. Results are never negative, so only the top is checked. */
function toMillimes(exact: bigint, what: string): Millimes {
  if (exact > MAX_MILLIMES_BIG) {
    throw new MoneyRangeError(`${what} exceeds the largest amount (${MAX_MILLIMES} millimes)`)
  }
  return toNumber(exact) as Millimes
}

/** numerator / denominator rounded half-up, for values >= 0 and a denominator > 0. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator)
}

// One optional decimal part of 1 to 3 digits. [0-9] and not \d on purpose, to make it
// obvious that only ASCII digits are accepted.
const USER_NUMBER = /^[0-9]+(?:\.[0-9]{1,3})?$/
// What Postgres prints for a numeric(n,3): no leading zero except "0", exactly 3 decimals.
const DB_NUMERIC = /^(?:0|[1-9][0-9]*)\.[0-9]{3}$/

/** Text typed by a user -> value x 1000, or null. */
function parseScaled(text: string, max: number): number | null {
  // A decimal comma or a decimal point. Only the first comma is replaced, so a second
  // separator of either kind is still there and fails the pattern.
  const normalized = text.trim().replace(',', '.')
  if (!USER_NUMBER.test(normalized)) return null
  const point = normalized.indexOf('.')
  const whole = point === -1 ? normalized : normalized.slice(0, point)
  const decimals = point === -1 ? '' : normalized.slice(point + 1)
  const scaled = BigInt(whole) * 1000n + BigInt(decimals.padEnd(3, '0'))
  return scaled > BigInt(max) ? null : toNumber(scaled)
}

/** Text printed by Postgres -> value x 1000. */
function fromDb(text: string, max: number, what: string): number {
  if (!DB_NUMERIC.test(text)) throw new MoneyFormatError(`${what} is not a database numeric with 3 decimals`)
  const scaled = BigInt(text.replace('.', ''))
  if (scaled > BigInt(max)) throw new MoneyRangeError(`${what} exceeds ${max}`)
  return toNumber(scaled)
}

function lineTotalExact(quantity: QtyMilli, unitPrice: Millimes): bigint {
  checked(quantity, MAX_QTY_MILLI, 'quantity')
  checked(unitPrice, MAX_MILLIMES, 'unit price')
  // (quantity x 1000) x (price x 1000) is the total x 1 000 000: divide by 1000 for millimes.
  return divideHalfUp(BigInt(quantity) * BigInt(unitPrice), 1000n)
}

function withTotal(line: Line): LineTotal {
  return { ...line, totalHT: toMillimes(lineTotalExact(line.quantity, line.unitPrice), 'line total') }
}

function groupByRate(lines: readonly LineTotal[]): TvaLine[] {
  const bases = new Map<RateMilli, bigint>()
  for (const line of lines) {
    checked(line.tvaRate, MAX_RATE_MILLI, 'TVA rate')
    bases.set(line.tvaRate, (bases.get(line.tvaRate) ?? 0n) + BigInt(line.totalHT))
  }
  return [...bases.entries()]
    .sort(([rateA], [rateB]) => rateA - rateB)
    .map(([rate, base]) => ({
      rate,
      baseHT: toMillimes(base, 'base HT'),
      // rate is percent x 1000: base x rate / (1000 x 100), rounded once for the whole rate.
      tva: toMillimes(divideHalfUp(base * BigInt(rate), 100_000n), 'TVA'),
    }))
}

// --- constructors (from an integer the program already has) ---------------------------------

/** @throws MoneyRangeError unless value is a whole number of millimes between 0 and the maximum. */
export function millimes(value: number): Millimes {
  return checked(value, MAX_MILLIMES, 'amount') as Millimes
}

/** @throws MoneyRangeError unless value is a whole number between 0 and the maximum. */
export function qtyMilli(value: number): QtyMilli {
  return checked(value, MAX_QTY_MILLI, 'quantity') as QtyMilli
}

/** @throws MoneyRangeError unless value is a whole number between 0 and 100 000 (100 %). */
export function rateMilli(value: number): RateMilli {
  return checked(value, MAX_RATE_MILLI, 'rate') as RateMilli
}

// --- text typed by the user -----------------------------------------------------------------
// Accepted: digits, then optionally ONE separator (comma or point) and 1 to 3 digits.
// "12", "12,5", "12.500", "0,001". Spaces around the text are ignored.
// Rejected (null): empty, a sign, an exponent, more than 3 decimals, a thousands separator
// or a space inside, ".5", "12.", two separators, digits that are not 0-9, and any value
// above the maximum. Zero is a valid result; "must be more than zero" is the form's rule.

export function parseMillimes(text: string): Millimes | null {
  return parseScaled(text, MAX_MILLIMES) as Millimes | null
}

export function parseQuantity(text: string): QtyMilli | null {
  return parseScaled(text, MAX_QTY_MILLI) as QtyMilli | null
}

/** A percentage: "19", "7,5", "0.125". Above 100 is rejected. */
export function parseRate(text: string): RateMilli | null {
  return parseScaled(text, MAX_RATE_MILLI) as RateMilli | null
}

// --- text exchanged with Postgres -------------------------------------------------------------
// Money, quantities and rates are selected as text ("column::text") and sent back as text,
// so they never pass through a JavaScript float. The form is strict: "1234.500".

/** @throws MoneyFormatError for any other form, MoneyRangeError above the maximum. */
export function fromDbNumeric(text: string): Millimes {
  return fromDb(text, MAX_MILLIMES, 'amount') as Millimes
}

/** @throws MoneyFormatError for any other form, MoneyRangeError above the maximum. */
export function fromDbQuantity(text: string): QtyMilli {
  return fromDb(text, MAX_QTY_MILLI, 'quantity') as QtyMilli
}

/** @throws MoneyFormatError for any other form, MoneyRangeError above 100 %. */
export function fromDbRate(text: string): RateMilli {
  return fromDb(text, MAX_RATE_MILLI, 'rate') as RateMilli
}

/** 1234500 -> "1234.500". Works for amounts, quantities and rates (all are value x 1000). */
export function toDbNumeric(value: Millimes | QtyMilli | RateMilli): string {
  const digits = String(checked(value, MAX_MILLIMES, 'value')).padStart(4, '0')
  return `${digits.slice(0, -3)}.${digits.slice(-3)}`
}

// --- display ----------------------------------------------------------------------------------

/**
 * French display: groups of three digits, a decimal comma, always 3 decimals.
 * 1234500 -> "1 234,500" (the space is GROUP_SEPARATOR). No currency symbol: the screen adds it.
 * Written by hand instead of Intl.NumberFormat so the result does not depend on the
 * runtime's locale data.
 */
export function formatMillimes(value: Millimes): string {
  const digits = String(checked(value, MAX_MILLIMES, 'amount')).padStart(4, '0')
  const whole = digits.slice(0, -3).replace(/\B(?=(?:[0-9]{3})+$)/g, GROUP_SEPARATOR)
  return `${whole},${digits.slice(-3)}`
}

// --- calculations -------------------------------------------------------------------------------

/** quantity x unit price, rounded half-up to the millime. @throws MoneyRangeError above the maximum. */
export function lineTotalHT(quantity: QtyMilli, unitPrice: Millimes): Millimes {
  return toMillimes(lineTotalExact(quantity, unitPrice), 'line total')
}

/**
 * The TVA table of a document: one entry per rate, sorted by rate.
 * baseHT = sum of the line totals of that rate; tva = baseHT x rate / 100 rounded half-up,
 * computed once per rate. @throws MoneyRangeError above the maximum.
 */
export function tvaByRate(lines: readonly Line[]): TvaLine[] {
  return groupByRate(lines.map(withTotal))
}

/**
 * Every total of a document. No lines gives zeros (plus the timbre, if one is given).
 * @throws MoneyRangeError if any line total, base, TVA or total exceeds the maximum.
 */
export function computeTotals(input: { readonly lines: readonly Line[]; readonly timbre: Millimes | null }): Totals {
  const lines = input.lines.map(withTotal)
  const tvaLines = groupByRate(lines)
  const totalHT = tvaLines.reduce((sum, tvaLine) => sum + BigInt(tvaLine.baseHT), 0n)
  const totalTVA = tvaLines.reduce((sum, tvaLine) => sum + BigInt(tvaLine.tva), 0n)
  const timbre = input.timbre === null ? 0n : BigInt(checked(input.timbre, MAX_MILLIMES, 'timbre'))
  return {
    lines,
    tvaLines,
    totalHT: toMillimes(totalHT, 'total HT'),
    totalTVA: toMillimes(totalTVA, 'total TVA'),
    timbre: input.timbre,
    totalTTC: toMillimes(totalHT + totalTVA + timbre, 'total TTC'),
  }
}
