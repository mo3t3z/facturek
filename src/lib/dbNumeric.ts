import { type Millimes, type QtyMilli, type RateMilli, toDbNumeric } from './money/money'

/**
 * A money / quantity / rate value for a numeric column of an INSERT or UPDATE.
 *
 * It is sent as TEXT ("1234.500"), which Postgres reads exactly. The generated types
 * (database.types.ts) describe numeric columns as `number`, because that is what
 * PostgREST returns by default; a JavaScript number is a float, so we never build one.
 * This function is the ONE place where that mismatch is bridged with a type cast: at
 * runtime the value is, and stays, a string (see dbNumeric.test.ts).
 */
export function dbNumeric(value: Millimes | QtyMilli | RateMilli | null): number | null {
  if (value === null) return null
  const text: string = toDbNumeric(value)
  return text as unknown as number
}
