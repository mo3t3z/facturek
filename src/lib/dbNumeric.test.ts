import { describe, expect, it } from 'vitest'
import { dbNumeric } from './dbNumeric'
import { millimes, qtyMilli, rateMilli } from './money/money'

describe('dbNumeric', () => {
  it('sends a string with exactly 3 decimals, whatever the TypeScript type says', () => {
    const amount: unknown = dbNumeric(millimes(1234500))
    expect(typeof amount).toBe('string')
    expect(amount).toBe('1234.500')
    expect(dbNumeric(rateMilli(19000)) as unknown).toBe('19.000')
    expect(dbNumeric(qtyMilli(1)) as unknown).toBe('0.001')
    expect(dbNumeric(millimes(0)) as unknown).toBe('0.000')
  })

  it('is what ends up in the JSON body of the request', () => {
    expect(JSON.stringify({ timbre_fiscal: dbNumeric(millimes(1000)), default_tva_rate: dbNumeric(null) })).toBe(
      '{"timbre_fiscal":"1.000","default_tva_rate":null}',
    )
  })

  it('keeps NULL as NULL', () => {
    expect(dbNumeric(null)).toBeNull()
  })
})
