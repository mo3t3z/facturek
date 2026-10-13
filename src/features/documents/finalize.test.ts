import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTotals, millimes, qtyMilli, rateMilli } from '../../lib/money/money'

// finalize_document(p_document_id, p_expected_net_a_payer): what the frontend sends.
// Plumbing only: there is no screen for it yet.

const db = vi.hoisted(() => ({
  /** Every request, in order: the organization check, then the RPC. */
  calls: [] as unknown[],
  found: { data: { id: 'x' } as unknown, error: null as unknown },
  result: { data: null as unknown, error: null as unknown },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, select: '', filters: [] as [string, string][] }
      db.calls.push(call)
      const builder = {
        select: (columns: string) => {
          call.select = columns
          return builder
        },
        eq: (column: string, value: string) => {
          call.filters.push([column, value])
          return builder
        },
        single: () => Promise.resolve(db.found),
      }
      return builder
    },
    rpc: (name: string, args: unknown) => {
      db.calls.push({ rpc: name, args })
      return Promise.resolve(db.result)
    },
  },
}))

import { finalizeDocument } from './api'
import { finalizePayload } from './payload'

const DOCUMENT = '22222222-2222-4222-8222-222222222222'

describe('finalizePayload', () => {
  it('has exactly the two arguments of the function', () => {
    expect(Object.keys(finalizePayload(DOCUMENT, millimes(1190600)))).toEqual(['p_document_id', 'p_expected_net_a_payer'])
  })

  it('sends the expected total as text with 3 decimals, never as a number', () => {
    const payload = finalizePayload(DOCUMENT, millimes(1190600))
    expect(payload).toEqual({ p_document_id: DOCUMENT, p_expected_net_a_payer: '1190.600' })
    expect(typeof payload.p_expected_net_a_payer).toBe('string')
    // What goes on the wire: a JSON string, with its quotes and its trailing zeros.
    expect(JSON.stringify(payload)).toBe(`{"p_document_id":"${DOCUMENT}","p_expected_net_a_payer":"1190.600"}`)
  })

  it.each([
    [0, '0.000'],
    [1, '0.001'],
    [100000, '100.000'],
    [1190600, '1190.600'],
    [999999999999, '999999999.999'],
  ])('writes %d millimes as "%s", the exact form Postgres prints a numeric(12,3)', (value, text) => {
    const sent = finalizePayload(DOCUMENT, millimes(value)).p_expected_net_a_payer
    expect(sent).toBe(text)
    expect(sent).toMatch(/^(0|[1-9][0-9]*)\.[0-9]{3}$/)
  })

  it('sends the net à payer of computeTotals, timbre included, not the total TTC', () => {
    const totals = computeTotals({
      lines: [{ quantity: qtyMilli(2000), unitPrice: millimes(10000), tvaRate: rateMilli(19000) }],
      timbre: millimes(1000),
    })
    expect(finalizePayload(DOCUMENT, totals.netAPayer).p_expected_net_a_payer).toBe('24.800')
    expect(finalizePayload(DOCUMENT, totals.totalTTC).p_expected_net_a_payer).toBe('23.800')
  })

  it('refuses a value that is not a whole number of millimes instead of sending something approximate', () => {
    expect(() => finalizePayload(DOCUMENT, 1190.6 as ReturnType<typeof millimes>)).toThrow()
    expect(() => finalizePayload(DOCUMENT, Number.NaN as ReturnType<typeof millimes>)).toThrow()
    expect(() => finalizePayload(DOCUMENT, -1 as ReturnType<typeof millimes>)).toThrow()
  })
})

describe('finalizeDocument', () => {
  // The row an RPC returns carries its numerics as JSON numbers: they must never be used.
  const row = { id: DOCUMENT, organization_id: 'org-1', number: 7, year: 2026, status: 'sent', net_a_payer: 1190.6, total_ttc: 1190.6 }

  beforeEach(() => {
    db.calls.length = 0
    db.found = { data: { id: DOCUMENT }, error: null }
    db.result = { data: row, error: null }
  })

  it('checks the organization first, then calls the RPC with the payload: two arguments, the total as text', async () => {
    await finalizeDocument('org-1', DOCUMENT, millimes(1190600))
    expect(db.calls).toEqual([
      { table: 'documents', select: 'id', filters: [['organization_id', 'org-1'], ['id', DOCUMENT]] },
      { rpc: 'finalize_document', args: { p_document_id: DOCUMENT, p_expected_net_a_payer: '1190.600' } },
    ])
  })

  it('returns only id, number and year: no amount of the returned row gets out', async () => {
    const issued = await finalizeDocument('org-1', DOCUMENT, millimes(1190600))
    expect(issued).toEqual({ id: DOCUMENT, number: 7, year: 2026 })
    expect(Object.keys(issued)).toEqual(['id', 'number', 'year'])
  })

  it('issues nothing when the document is not in the organization of the screen', async () => {
    const notFound = { code: 'PGRST116', message: 'internal', details: null, hint: null }
    db.found = { data: null, error: notFound }
    await expect(finalizeDocument('org-2', DOCUMENT, millimes(1190600))).rejects.toBe(notFound)
    expect(db.calls).toHaveLength(1)
  })

  it.each(['DF009', 'DF022', 'DF023', 'DF004', 'PGRST202'])('throws the error of the database as it is (%s), for errorMessageKey()', async (code) => {
    const error = { code, message: 'internal', details: null, hint: null }
    db.result = { data: null, error }
    await expect(finalizeDocument('org-1', DOCUMENT, millimes(1))).rejects.toBe(error)
  })

  it('does not pretend a document was issued if the row has no number', async () => {
    db.result = { data: { ...row, number: null, year: null }, error: null }
    await expect(finalizeDocument('org-1', DOCUMENT, millimes(1))).rejects.toThrow(/without a number/)
  })
})
