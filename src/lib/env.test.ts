import { describe, expect, it } from 'vitest'
import { isPrivilegedKey, parseEnv } from './env'

const b64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fakeJwt = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.signature`

const url = 'http://127.0.0.1:54321'
const anonJwt = fakeJwt({ iss: 'supabase-demo', role: 'anon', exp: 1983812996 })
const serviceJwt = fakeJwt({ iss: 'supabase-demo', role: 'service_role', exp: 1983812996 })

describe('parseEnv', () => {
  it('accepts a URL with an anon JWT', () => {
    expect(parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonJwt }).VITE_SUPABASE_URL).toBe(url)
  })

  it('accepts a publishable key', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc123' })).not.toThrow()
  })

  it('names the missing variable', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: url })).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('rejects a malformed URL', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'not-a-url', VITE_SUPABASE_ANON_KEY: anonJwt })).toThrow(
      /VITE_SUPABASE_URL/,
    )
  })

  it.each(['http://127.0.0.1:54321', 'https://abc.supabase.co', 'HTTPS://ABC.SUPABASE.CO'])(
    'accepts the http(s) URL %s',
    (value) => {
      expect(() => parseEnv({ VITE_SUPABASE_URL: value, VITE_SUPABASE_ANON_KEY: anonJwt })).not.toThrow()
    },
  )

  it.each([
    'javascript:alert(1)',
    'data:text/plain,x',
    'file:///etc/passwd',
    'ftp://example.com',
    'ws://example.com',
    'blob:https://example.com/x',
    '//example.com',
    'example.com',
  ])('rejects the non-http(s) URL %s', (value) => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: value, VITE_SUPABASE_ANON_KEY: anonJwt })).toThrow(/VITE_SUPABASE_URL/)
  })

  it('rejects a secret key (sb_secret_...)', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_secret_do_not_ship' })).toThrow(
      /must never be shipped to a browser/,
    )
  })

  it('rejects a JWT whose role claim is service_role', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: serviceJwt })).toThrow(
      /must never be shipped to a browser/,
    )
  })

  it('never puts a key value in the error message', () => {
    for (const key of ['sb_secret_do_not_ship', serviceJwt]) {
      try {
        parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key })
        expect.unreachable()
      } catch (error) {
        expect(String(error)).not.toContain(key)
        expect(String(error)).not.toContain(key.slice(0, 20))
      }
    }
  })

  it('ignores any other variable, so nothing else can be read from the environment', () => {
    const env = parseEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonJwt, VITE_OTHER: 'x' })
    expect(Object.keys(env).sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL'])
  })
})

describe('isPrivilegedKey', () => {
  it('flags secret and service_role keys only', () => {
    expect(isPrivilegedKey('sb_secret_x')).toBe(true)
    expect(isPrivilegedKey(serviceJwt)).toBe(true)
    expect(isPrivilegedKey(anonJwt)).toBe(false)
    expect(isPrivilegedKey('sb_publishable_x')).toBe(false)
    expect(isPrivilegedKey('not.a.jwt')).toBe(false)
  })
})
