import { describe, expect, it } from 'vitest'

// Rules that hold for the whole application source (tests excluded).
const sources = import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const appSources = Object.entries(sources).filter(
  ([path]) => !path.includes('.test.') && !path.startsWith('./') && !path.includes('/test/') && !path.includes('database.types'),
)

function filesContaining(pattern: RegExp): string[] {
  return appSources.filter(([, code]) => pattern.test(code)).map(([path]) => path)
}

describe('source rules', () => {
  it('finds the application sources', () => {
    expect(appSources.length).toBeGreaterThan(15)
    expect(appSources.some(([path]) => path.endsWith('AuthProvider.tsx'))).toBe(true)
  })

  it('never uses dangerouslySetInnerHTML or writes HTML strings into the DOM', () => {
    expect(filesContaining(/dangerouslySetInnerHTML/)).toEqual([])
    expect(filesContaining(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/)).toEqual([])
  })

  it('never stores or reads a token itself (supabase-js owns the session)', () => {
    expect(filesContaining(/localStorage|sessionStorage|document\.cookie|indexedDB/)).toEqual([])
    expect(filesContaining(/access_token|refresh_token/)).toEqual([])
  })

  it('never logs to the console (a key or a token could end up there)', () => {
    expect(filesContaining(/console\.(log|info|debug|warn|error)/)).toEqual([])
  })

  it('reads the environment in exactly one place', () => {
    expect(filesContaining(/import\.meta\.env/)).toEqual(['../lib/supabase.ts'])
  })
})
