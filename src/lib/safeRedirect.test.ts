import { describe, expect, it } from 'vitest'
import { DEFAULT_REDIRECT, safeRedirectPath } from './safeRedirect'

describe('safeRedirectPath', () => {
  it.each([
    ['/app', '/app'],
    ['/app/factures/12', '/app/factures/12'],
    ['/app?tab=devis', '/app?tab=devis'],
    ['/app/clients?q=a%20b#top', '/app/clients?q=a%20b#top'],
    ['/reset-password', '/reset-password'],
  ])('accepts the local path %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected)
  })

  it.each([
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
  ])('rejects %j and falls back to the default', (input) => {
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
  })

  it('normalises dot segments instead of letting them escape', () => {
    expect(safeRedirectPath('/app/../../x')).toBe('/x')
  })

  it('never returns anything that does not start with a single slash', () => {
    for (const input of ['//evil.com', '/\\evil.com', '/%2F%2Fevil.com', '/app', 'https://evil.com']) {
      const result = safeRedirectPath(input)
      expect(result.startsWith('/')).toBe(true)
      expect(result.startsWith('//')).toBe(false)
      expect(result).not.toContain('\\')
    }
  })
})
