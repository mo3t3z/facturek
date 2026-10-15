// The ONE place where a backend error becomes something we show to the user.
//
// It returns an i18n key, never the error's own text: raw messages can contain SQL,
// constraint names or internal details, and they are not translated. Anything we do not
// recognise becomes a generic message.

/** Supabase Auth error codes we have a specific message for. */
const AUTH_CODES = new Set([
  'weak_password',
  'same_password',
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'otp_expired',
  'session_not_found',
  'signup_disabled',
  'validation_failed',
])

// One generic message for every way a login can fail, so the screen does not reveal
// whether the address exists or is merely unconfirmed.
const LOGIN_FAILURE_CODES = new Set(['invalid_credentials', 'email_not_confirmed', 'user_not_found', 'user_banned'])

/** Postgres SQLSTATE codes we have a specific message for (see the table in CLAUDE.md). */
const DB_CODES = new Set([
  'DF000', 'DF001', 'DF002', 'DF003', 'DF004', 'DF005', 'DF006', 'DF007', 'DF008', 'DF009',
  'DF010', 'DF011', 'DF012', 'DF013', 'DF014', 'DF015', 'DF016', 'DF017', 'DF018', 'DF019',
  'DF020', 'DF021', 'DF022', 'DF023', 'DF024', 'DF040',
  '42501', // insufficient privilege / row level security
  '23503', // foreign key
  '23505', // unique
  '23514', // check constraint
  'PGRST116', // .single() found no row: gone, or hidden by RLS (PostgREST)
  'PGRST301', // JWT expired or invalid (PostgREST)
])

export const UNKNOWN_ERROR_KEY = 'errors.unknown'
export const NETWORK_ERROR_KEY = 'errors.network'
export const LOGIN_FAILED_KEY = 'errors.auth.login_failed'

function readString(source: object, field: string): string | null {
  const value = (source as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

/**
 * True when the request never got an answer (offline, server down, CORS, timeout).
 * fetch() throws a TypeError, but so does a bug in our own code ("Cannot read properties of
 * undefined"), so the type alone proves nothing: the message must be one of fetch's.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = readString(error, 'name')
  if (name === 'AuthRetryableFetchError') return true
  const message = readString(error, 'message') ?? ''
  return /failed to fetch|networkerror|load failed/i.test(message)
}

/**
 * Maps any error coming back from Supabase (Auth, PostgREST, RPC) to an i18n key.
 * Works on the `code` field only; the message is never read for display.
 *
 * `specific` lets a screen give a more precise message for a code whose meaning it knows
 * from what it just did. Example: deleting a client can only raise 23503 because a
 * document still points at it, so that screen passes { '23503': 'clients.errors.inUse' }.
 * It is still a code -> key lookup: the backend text never reaches the user.
 */
export function errorMessageKey(error: unknown, specific: Readonly<Record<string, string>> = {}): string {
  if (isNetworkError(error)) return NETWORK_ERROR_KEY
  if (typeof error !== 'object' || error === null) return UNKNOWN_ERROR_KEY

  const code = readString(error, 'code')
  if (code === null) return UNKNOWN_ERROR_KEY
  const specificKey = Object.hasOwn(specific, code) ? specific[code] : undefined
  if (specificKey !== undefined) return specificKey
  if (LOGIN_FAILURE_CODES.has(code)) return LOGIN_FAILED_KEY
  if (AUTH_CODES.has(code)) return `errors.auth.${code}`
  if (DB_CODES.has(code)) return `errors.db.${code}`
  return UNKNOWN_ERROR_KEY
}
