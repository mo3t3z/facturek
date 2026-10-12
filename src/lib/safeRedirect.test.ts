import { describe, expect, it } from 'vitest'
import { DEFAULT_REDIRECT, safeRedirectPath } from './safeRedirect'

const BASE = 'https://app.invalid'

const SAFE: [input: string, expected: string][] = [
  ['/app', '/app'],
  ['/app?x=1#y', '/app?x=1#y'],
  ['/app/clients/12', '/app/clients/12'],
  ['/app/factures/12', '/app/factures/12'],
  ['/app?tab=devis', '/app?tab=devis'],
  ['/app/clients?q=a%20b#top', '/app/clients?q=a%20b#top'],
  ['/reset-password', '/reset-password'],
]

// Dot segments: each of these LOOKS like a local path, and the URL parser turns it into
// "//evil.com" (another host) while reporting the same origin.
const DOT_SEGMENT_ESCAPES = [
  '/.//evil.com',
  '/..//evil.com',
  '/a/..//evil.com',
  '/%2e//evil.com',
  '/%2e%2e//evil.com',
  '/a/%2e%2e//evil.com',
  '/.//evil.com?x=1',
  '/.//evil.com#y',
  '/..//evil.com?x=1#y',
  '/a/..//evil.com?next=/app',
  '/%2e//evil.com?x=1',
  '/%2E%2E//evil.com#y',
  '/a/b/../..//evil.com',
  '/././/evil.com',
  '/.././/evil.com',
  '/a/.././/evil.com/app',
  '/.//evil.com/',
  '/..///evil.com',
  '/.//\\evil.com',
  '/%2e/%2fevil.com',
]

const OTHER_HOSTILE = [
  // another host
  '//evil.com',
  '//evil.com/app',
  '///evil.com',
  '////evil.com',
  'https://evil.com',
  'http://evil.com/app',
  'HTTPS://EVIL.COM',
  'evil.com',
  'evil.com/app',
  '@evil.com',
  // schemes
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'mailto:a@b.c',
  // backslashes (browsers treat "\" as "/")
  '/\\evil.com',
  '\\\\evil.com',
  '/\\/evil.com',
  '\\/evil.com',
  // encoded variants
  '/%2F%2Fevil.com',
  '/%2fevil.com',
  '%2F%2Fevil.com',
  '/%5Cevil.com',
  '/%5c%5cevil.com',
  '/%252F%252Fevil.com',
  '/%25252Fevil.com',
  '%68ttps://evil.com',
  // whitespace and control characters (stripped by browsers inside URLs)
  '/\t/evil.com',
  '/\n/evil.com',
  '/\r/evil.com',
  '/%09/evil.com',
  '/%0A/evil.com',
  '/%0D%0A/evil.com',
  '/%00/evil.com',
  ' /app',
  '/app ',
  '/a b',
  // malformed
  '/%',
  '/%E0%A4%A',
  '/%zz',
  '',
  '.',
  '..',
  '../app',
  'app',
  '?next=/app',
  '#/app',
]

const ALL_HOSTILE = [...DOT_SEGMENT_ESCAPES, ...OTHER_HOSTILE]

/** What every returned value must satisfy, whatever went in. */
function expectSafeOutput(result: string) {
  expect(result.startsWith('/')).toBe(true)
  expect(result.startsWith('//')).toBe(false)
  expect(result).not.toContain('\\')
  // eslint-disable-next-line no-control-regex
  expect(result).not.toMatch(/[\u0000- \u007f]/)
  expect(new URL(result, BASE).origin).toBe(BASE)
}

describe('safeRedirectPath', () => {
  it.each(SAFE)('returns the local path %s unchanged', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected)
  })

  it.each(DOT_SEGMENT_ESCAPES)('rejects the dot-segment escape %j', (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT)
  })

  it.each(OTHER_HOSTILE)('rejects %j and falls back to the default', (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT)
  })

  it.each([null, undefined, 42, {}, ['/app'], true])('rejects the non-string value %j', (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT)
  })

  it('rejects an absurdly long value', () => {
    expect(safeRedirectPath(`/${'a'.repeat(3000)}`)).toBe(DEFAULT_REDIRECT)
  })

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//evil.com', '/login')).toBe('/login')
    expect(safeRedirectPath('/.//evil.com', '/login')).toBe('/login')
  })

  it('still normalises harmless dot segments', () => {
    expect(safeRedirectPath('/app/../../x')).toBe('/x')
    expect(safeRedirectPath('/app/./clients')).toBe('/app/clients')
  })
})

describe('safeRedirectPath: property over every hostile input', () => {
  it('has at least 50 hostile inputs to try', () => {
    expect(ALL_HOSTILE.length).toBeGreaterThanOrEqual(50)
    expect(new Set(ALL_HOSTILE).size).toBe(ALL_HOSTILE.length)
  })

  it.each(ALL_HOSTILE)('the value returned for %j is a path of this application', (input) => {
    expectSafeOutput(safeRedirectPath(input))
  })

  it.each(ALL_HOSTILE)('and it never contains the attacker host, for %j', (input) => {
    expect(safeRedirectPath(input).toLowerCase()).not.toContain('evil.com')
  })

  it('holds for the safe inputs too', () => {
    for (const [input] of SAFE) expectSafeOutput(safeRedirectPath(input))
  })

  it('holds when hostile inputs are combined with prefixes, queries and hashes', () => {
    const prefixes = ['', '/', '/.', '/..', '/a/..', '/%2e', '/%2e%2e', '/app/..']
    const suffixes = ['', '?x=1', '#y', '?x=1#y', '/', '/app']
    let tried = 0
    for (const prefix of prefixes) {
      for (const hostile of ['//evil.com', '/\\evil.com', '/%2F%2Fevil.com', '///evil.com', '/.//evil.com']) {
        for (const suffix of suffixes) {
          expectSafeOutput(safeRedirectPath(`${prefix}${hostile}${suffix}`))
          tried++
        }
      }
    }
    expect(tried).toBe(240)
  })
})
