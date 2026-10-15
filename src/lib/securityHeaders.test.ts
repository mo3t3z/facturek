import { describe, expect, it } from 'vitest'
import { headersFile, securityHeaders } from './securityHeaders'

const directives = (csp: string) => new Map(csp.split('; ').map((part) => [part.split(' ')[0], part.split(' ').slice(1)]))

describe('securityHeaders', () => {
  const headers = securityHeaders('https://abcd.supabase.co')
  const csp = directives(headers['Content-Security-Policy'] ?? '')

  it('allows scripts and styles from our own origin only: no inline, no eval', () => {
    expect(csp.get('script-src')).toEqual(["'self'"])
    expect(csp.get('style-src')).toEqual(["'self'"])
    expect(headers['Content-Security-Policy']).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
  })

  it('lets the app talk to its own origin and to the ONE Supabase project, nothing else', () => {
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://abcd.supabase.co'])
  })

  it('keeps only the origin of the Supabase URL, never a path', () => {
    const fromPath = directives(securityHeaders('https://abcd.supabase.co/rest/v1')['Content-Security-Policy'] ?? '')
    expect(fromPath.get('connect-src')).toEqual(["'self'", 'https://abcd.supabase.co'])
  })

  it('cannot be framed, has no plugin, and fixes base and form targets', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'self'"])
    expect(csp.get('form-action')).toEqual(["'self'"])
  })

  it('sends no referrer (the confirmation link carries a token) and never sniffs types', () => {
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('refuses a URL that is not http or https', () => {
    expect(() => securityHeaders('javascript:alert(1)')).toThrow()
    expect(() => securityHeaders('not a url')).toThrow()
  })

  it('writes the _headers file: one rule for every path', () => {
    const file = headersFile('https://abcd.supabase.co')
    expect(file.split('\n')[0]).toBe('/*')
    expect(file).toContain('  Content-Security-Policy: default-src')
    expect(file).toContain('  Referrer-Policy: no-referrer')
  })
})
