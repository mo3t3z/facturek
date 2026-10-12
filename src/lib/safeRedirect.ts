// Validation of "where to go next" values (the ?next= parameter).
//
// Such a value comes from the URL, so an attacker can craft a link to our own login page
// that sends the user somewhere else after they log in (open redirect, used for phishing).
// The only thing we accept is a path inside this application: it must start with exactly
// one "/" and still be same-origin once the browser has parsed it.

export const DEFAULT_REDIRECT = '/app'

// The base is only there so that URL() can parse a relative path. ".invalid" is reserved
// and can never be a real host, so "same origin as the base" means "stayed relative".
const BASE = 'https://app.invalid'

function looksLikeLocalPath(value: string, isDecoded: boolean): boolean {
  if (!value.startsWith('/')) return false // "https://evil.com", "javascript:...", "evil.com"
  if (value.startsWith('//')) return false // "//evil.com" is another host
  if (value.includes('\\')) return false // browsers read "\" as "/": "/\evil.com"
  // Control characters: browsers strip tab / newline inside URLs ("/\t/evil.com" -> "//evil.com").
  // A literal space is refused too; an encoded one (%20) is fine once decoded.
  const lowestAllowed = isDecoded ? 0x20 : 0x21
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < lowestAllowed || code === 0x7f) return false
  }
  return true
}

/**
 * Returns `raw` if it is a safe path inside this application, otherwise `fallback`.
 * The result is always safe to pass to the router's navigate().
 */
export function safeRedirectPath(raw: unknown, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return fallback

  // Check the value as given AND every decoded form of it ("/%2F%2Fevil.com",
  // "/%5Cevil.com", double encoding...). A value that cannot be decoded is refused.
  let current = raw
  for (let round = 0; round < 4; round++) {
    if (!looksLikeLocalPath(current, round > 0)) return fallback
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return fallback
    }
    if (decoded === current) break
    current = decoded
    if (round === 3) return fallback // still changing after 4 rounds: refuse
  }

  // Final word to the same parser the browser uses.
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback

  return `${url.pathname}${url.search}${url.hash}`
}
