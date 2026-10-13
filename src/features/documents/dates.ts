// Dates of a document are calendar days, not moments: "2026-10-13" is the 13th whatever
// the time zone. They stay plain "YYYY-MM-DD" strings from the <input type="date"> to the
// database and back. They never go through the JavaScript date object: converting a local
// midnight to UTC and printing it would give the day before in Tunisia (UTC+1).
// src/test/sourceRules.test.ts bans that object in this feature.

const ISO_DAY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/** True for a real calendar day written "YYYY-MM-DD" ("2026-02-30" and "2026-2-3" are not). */
export function isIsoDay(text: string): boolean {
  const match = ISO_DAY.exec(text)
  if (!match) return false
  // The pattern guarantees three groups of digits: parseInt reads whole numbers only.
  const year = Number.parseInt(match[1] ?? '', 10)
  const month = Number.parseInt(match[2] ?? '', 10)
  const day = Number.parseInt(match[3] ?? '', 10)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const lastDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0)
  return day <= lastDay
}

/** "YYYY-MM-DD" strings sort like the days they name, so comparing the text is enough. */
export function isBeforeDay(day: string, other: string): boolean {
  return day < other
}

/** "2026-10-13" -> "13/10/2026" (French order). Anything else is returned unchanged. */
export function formatDay(day: string): string {
  const match = ISO_DAY.exec(day)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : day
}
