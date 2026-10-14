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

  it('never selects a numeric column without ::text (a JSON number is a float)', () => {
    const numericColumns = [
      'default_tva_rate', 'timbre_fiscal', 'retenue_rate', 'retenue_threshold',
      // document_items and payments
      'quantity', 'unit_price', 'tva_rate', 'amount',
      // stored totals of an issued document
      'total_ht', 'total_tva', 'total_ttc', 'net_a_payer',
    ]
    // Every string given to .select(...), directly or through a constant named *_COLUMNS.
    const selections = (code: string) => [
      ...[...code.matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/g)].map((match) => match[2] ?? ''),
      ...[...code.matchAll(/\b[A-Z_]*COLUMNS\s*=\s*(['"`])([\s\S]*?)\1/g)].map((match) => match[2] ?? ''),
    ]
    const offenders = appSources.flatMap(([path, code]) =>
      selections(code).flatMap((selection) =>
        numericColumns
          .filter((column) => new RegExp(`\\b${column}\\b(?!::text)`).test(selection))
          .map((column) => `${path}: ${column} in "${selection}"`),
      ),
    )
    expect(offenders).toEqual([])
    // The rule really looks at the settings query.
    const settingsApi = appSources.find(([path]) => path.endsWith('features/settings/api.ts'))?.[1] ?? ''
    expect(selections(settingsApi).some((selection) => selection.includes('default_tva_rate::text'))).toBe(true)
    // ...and at the stored totals of the documents queries (list and detail).
    const documentsApi = appSources.find(([path]) => path.endsWith('features/documents/api.ts'))?.[1] ?? ''
    expect(selections(documentsApi).filter((selection) => selection.includes('net_a_payer::text'))).toHaveLength(2)
    // select('*') would return every numeric column as a float.
    expect(filesContaining(/\.select\(\s*(['"`])\s*\*/)).toEqual([])
    expect(filesContaining(/\.select\(\s*\)/)).toEqual([])
  })

  it('keeps document dates as plain text: no Date object in src/features/documents', () => {
    // A date of a document is a calendar day. Going through Date / toISOString converts a
    // local midnight to UTC, which is the day before in Tunisia (UTC+1).
    const inDocuments = (pattern: RegExp) => filesContaining(pattern).filter((path) => path.includes('/features/documents/'))
    expect(appSources.some(([path]) => path.includes('/features/documents/'))).toBe(true)
    expect(inDocuments(/new Date\(|\bDate\.(now|parse|UTC)\b/)).toEqual([])
    expect(inDocuments(/toISOString|toLocaleDateString|toJSON\(|valueAsDate|getTimezoneOffset/)).toEqual([])
  })

  it('does no number crunching in src/features/documents: amounts come from src/lib/money only', () => {
    const inDocuments = (pattern: RegExp) => filesContaining(pattern).filter((path) => path.includes('/features/documents/'))
    expect(inDocuments(/parseFloat|\bNumber\(|toFixed|Math\.round/)).toEqual([])
    // The issued view reads the stored totals and computes nothing: no computeTotals there.
    const issued = appSources.filter(([path]) => /features\/documents\/(components\/IssuedDocument\.tsx|storedTotals\.ts)$/.test(path))
    expect(issued).toHaveLength(2)
    for (const [, code] of issued) expect(code).not.toMatch(/computeTotals\(|previewTotals\(|tvaByRate\(/)
    // The preview takes every amount from computeTotals / lineTotalHT.
    const preview = appSources.find(([path]) => path.endsWith('features/documents/preview.ts'))?.[1] ?? ''
    expect(preview).toMatch(/computeTotals\(/)
  })

  it('reads the environment in exactly one place', () => {
    expect(filesContaining(/import\.meta\.env/)).toEqual(['../lib/supabase.ts'])
  })
})
