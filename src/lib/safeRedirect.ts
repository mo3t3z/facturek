// Validation of "where to go next" values (the ?next= parameter).
//
// Such a value comes from the URL, so an attacker can craft a link to our own login page
// that sends the user somewhere else after they log in (open redirect, used for phishing).
// The only thing we accept is a path inside this application: it must start with exactly
// one "/" and still be same-origin once the browser has parsed it.
//
// Two checks, on purpose:
//   1. the INPUT, as given and in every decoded form;
//   2. the OUTPUT, after the URL parser has normalised it. The parser removes dot segments,
//      so an input that looks local ("/.//evil.com", "/a/..//evil.com") can come out as
//      "//evil.com", which a browser reads as another host. Only checking the input is
//      therefore not enough: what we return is what gets navigated to.

export const DEFAULT_REDIRECT = '/app'

// The base is only there so that URL() can parse a relative path. ".invalid" is reserved
// and can never be a real host, so "same origin as the base" means "stayed relative".
const BASE = 'https://app.invalid'

function hasControlCharacter(value: string, lowestAllowed: number): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < lowestAllowed || code === 0x7f) return true
  }
  return false
}

function looksLikeLocalPath(value: string, isDecoded: boolean): boolean {
  if (!value.startsWith('/')) return false // "https://evil.com", "javascript:...", "evil.com"
  if (value.startsWith('//')) return false // "//evil.com" is another host
  if (value.includes('\\')) return false // browsers read "\" as "/": "/\evil.com"
  // Control characters: browsers strip tab / newline inside URLs ("/\t/evil.com" -> "//evil.com").
  // A literal space is refused too; an encoded one (%20) is fine once decoded.
  return !hasControlCharacter(value, isDecoded ? 0x20 : 0x21)
}

/**
 * True when the value, as given AND in every decoded form ("/%2F%2Fevil.com",
 * "/%5Cevil.com", double encoding...), looks like a local path. A value that cannot be
 * decoded, or that keeps changing after 4 rounds of decoding, is refused.
 */
function isLocalInEveryDecodedForm(value: string): boolean {
  let current = value
  for (let round = 0; round < 4; round++) {
    if (!looksLikeLocalPath(current, round > 0)) return false
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return false
    }
    if (decoded === current) return true
    current = decoded
  }
  return false
}

/**
 * The value we are about to return must itself be a local path: exactly one leading "/",
 * no "\", no control character, as it is and in every decoded form (normalisation can
 * also leave an ENCODED "//" at the front: "/%2e/%2fevil.com" -> "/%2fevil.com"), and
 * still same-origin when parsed on its own.
 */
function isSafeOutput(path: string): boolean {
  if (!isLocalInEveryDecodedForm(path)) return false
  try {
    return new URL(path, BASE).origin === BASE
  } catch {
    return false
  }
}

/**
 * Returns `raw` if it is a safe path inside this application, otherwise `fallback`.
 * The result is always safe to pass to the router's navigate().
 */
export function safeRedirectPath(raw: unknown, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return fallback

  // 1. INPUT, as given and in every decoded form.
  if (!isLocalInEveryDecodedForm(raw)) return fallback

  // The same parser the browser uses. It also normalises the path ("/a/../b" -> "/b").
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback

  // 2. OUTPUT. Normalisation can turn a local-looking input into "//host": check what we
  // are actually about to return.
  const result = `${url.pathname}${url.search}${url.hash}`
  if (!isSafeOutput(result)) return fallback

  return result
}
