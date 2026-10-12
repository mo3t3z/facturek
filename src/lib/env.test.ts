import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('accepts a valid URL and anon key', () => {
    const env = parseEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:54321')
  })

  it('names the missing variable', () => {
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321' })).toThrow(
      /VITE_SUPABASE_ANON_KEY/,
    )
  })

  it('rejects a malformed URL', () => {
    expect(() =>
      parseEnv({ VITE_SUPABASE_URL: 'not-a-url', VITE_SUPABASE_ANON_KEY: 'anon-key' }),
    ).toThrow(/VITE_SUPABASE_URL/)
  })
})
