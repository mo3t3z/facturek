// Today's calendar day in Tunisia, "YYYY-MM-DD", whatever the time zone of the browser.
//
// It lives here and not in src/features/documents, where the Date object is banned
// (sourceRules.test.ts): that feature keeps days as plain text. This is the one place a
// moment becomes a day, through the time zone of Tunisia, never through toISOString (UTC
// would give yesterday between midnight and 1 a.m. in Tunis).
// Only used to PROPOSE a day in a form; Postgres decides with its own private.today_tunis().

export function todayInTunis(now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
