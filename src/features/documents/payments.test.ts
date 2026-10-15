import { beforeEach, describe, expect, it, vi } from 'vitest'
import { millimes } from '../../lib/money/money'
import { errorMessageKey } from '../../lib/errors'
import translations from '../../locales/fr/translation.json'

// record_payment(), cancel_devis() and the payments list: what the frontend sends and reads.
// Plumbing only: there is no screen for it yet (P2e3).

const db = vi.hoisted(() => ({
  calls: [] as unknown[],
  found: { data: { id: 'x' } as unknown, error: null as unknown },
  list: { data: [] as unknown, error: null as unknown },
  result: { data: null as unknown, error: null as unknown },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, select: '', filters: [] as [string, string][], order: [] as string[], limit: 0 }
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
        order: (column: string) => {
          call.order.push(column)
          return builder
        },
        limit: (count: number) => {
          call.limit = count
          return Promise.resolve(db.list)
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

import { cancelDevisPayload, PAYMENT_METHODS, paymentPayload } from './payload'
import { cancelDevis, listPayments, PAYMENTS_LIMIT, recordPayment } from './paymentsApi'

const DOCUMENT = '33333333-3333-4333-8333-333333333333'

describe('paymentPayload', () => {
  it('has exactly the four arguments of record_payment', () => {
    expect(Object.keys(paymentPayload(DOCUMENT, millimes(250000), '2026-10-15', 'virement'))).toEqual([
      'p_document_id', 'p_amount', 'p_paid_at', 'p_method',
    ])
  })

  it('sends the amount as text with 3 decimals, never as a number', () => {
    const payload = paymentPayload(DOCUMENT, millimes(250000), '2026-10-15', 'cheque')
    expect(payload).toEqual({ p_document_id: DOCUMENT, p_amount: '250.000', p_paid_at: '2026-10-15', p_method: 'cheque' })
    expect(typeof payload.p_amount).toBe('string')
    expect(JSON.stringify(payload)).toContain('"p_amount":"250.000"')
  })

  it.each([[1, '0.001'], [300, '0.300'], [101000, '101.000'], [999999999999, '999999999.999']])(
    'writes %d millimes as "%s", the only form Postgres accepts',
    (value, text) => {
      expect(paymentPayload(DOCUMENT, millimes(value), '2026-10-15', 'cash').p_amount).toBe(text)
    },
  )

  it('refuses zero before sending anything (Postgres would answer DF024)', () => {
    expect(() => paymentPayload(DOCUMENT, millimes(0), '2026-10-15', 'cash')).toThrow(RangeError)
  })

  it('refuses a value that is not a whole number of millimes', () => {
    expect(() => paymentPayload(DOCUMENT, 2.5 as ReturnType<typeof millimes>, '2026-10-15', 'cash')).toThrow()
  })

  it.each(['15/10/2026', '2026-10-15T00:00:00Z', '2026-02-30', ''])('refuses the date "%s": a payment is made on a calendar day', (day) => {
    expect(() => paymentPayload(DOCUMENT, millimes(1000), day, 'cash')).toThrow(RangeError)
  })

  it('knows exactly the three methods of the database', () => {
    expect([...PAYMENT_METHODS].sort()).toEqual(['cash', 'cheque', 'virement'])
  })
})

describe('cancelDevisPayload', () => {
  it('has exactly the one argument of cancel_devis', () => {
    expect(cancelDevisPayload(DOCUMENT)).toEqual({ p_devis_id: DOCUMENT })
  })
})

describe('listPayments', () => {
  beforeEach(() => {
    db.calls.length = 0
    db.list = { data: [{ id: 'p1', amount: '40.000', paid_at: '2026-10-01', method: 'virement' }], error: null }
  })

  it('selects the amount as text, names the organization and the document, in payment order', async () => {
    await listPayments('org-1', DOCUMENT)
    expect(db.calls).toEqual([{
      table: 'payments',
      select: 'id, amount::text, paid_at, method',
      filters: [['organization_id', 'org-1'], ['document_id', DOCUMENT]],
      order: ['paid_at', 'created_at', 'id'],
      limit: PAYMENTS_LIMIT,
    }])
  })

  it('parses the amount into millimes and keeps the day as text', async () => {
    expect(await listPayments('org-1', DOCUMENT)).toEqual([{ id: 'p1', amount: 40000, paidAt: '2026-10-01', method: 'virement' }])
  })

  it('refuses an amount that came back as a JSON number', async () => {
    db.list = { data: [{ id: 'p1', amount: 40, paid_at: '2026-10-01', method: 'virement' }], error: null }
    await expect(listPayments('org-1', DOCUMENT)).rejects.toThrow()
  })
})

describe('recordPayment', () => {
  beforeEach(() => {
    db.calls.length = 0
    db.found = { data: { id: DOCUMENT }, error: null }
    // An RPC returns its numerics as JSON numbers: they must never be used.
    db.result = { data: { id: 'pay-1', organization_id: 'org-1', document_id: DOCUMENT, amount: 250.5, paid_at: '2026-10-15', method: 'cash' }, error: null }
  })

  it('checks the organization first, then calls record_payment with the payload', async () => {
    await recordPayment('org-1', DOCUMENT, millimes(250500), '2026-10-15', 'cash')
    expect(db.calls).toEqual([
      { table: 'documents', select: 'id', filters: [['organization_id', 'org-1'], ['id', DOCUMENT]], order: [], limit: 0 },
      { rpc: 'record_payment', args: { p_document_id: DOCUMENT, p_amount: '250.500', p_paid_at: '2026-10-15', p_method: 'cash' } },
    ])
  })

  it('returns only the id: no amount of the returned row gets out', async () => {
    expect(await recordPayment('org-1', DOCUMENT, millimes(250500), '2026-10-15', 'cash')).toEqual({ id: 'pay-1' })
  })

  it('sends nothing for a document that is not in the organization of the screen', async () => {
    const notFound = { code: 'PGRST116', message: 'internal', details: null, hint: null }
    db.found = { data: null, error: notFound }
    await expect(recordPayment('org-2', DOCUMENT, millimes(1000), '2026-10-15', 'cash')).rejects.toBe(notFound)
    expect(db.calls).toHaveLength(1)
  })

  it('sends nothing at all for an invalid amount', async () => {
    await expect(recordPayment('org-1', DOCUMENT, millimes(0), '2026-10-15', 'cash')).rejects.toThrow(RangeError)
    expect(db.calls).toHaveLength(0)
  })

  it.each(['DF018', 'DF016', 'DF024', 'DF001'])('throws the error of the database as it is (%s)', async (code) => {
    const error = { code, message: 'internal', details: null, hint: null }
    db.result = { data: null, error }
    await expect(recordPayment('org-1', DOCUMENT, millimes(1000), '2026-10-15', 'cash')).rejects.toBe(error)
  })
})

describe('cancelDevis', () => {
  beforeEach(() => {
    db.calls.length = 0
    db.found = { data: { id: DOCUMENT }, error: null }
    db.result = { data: { id: DOCUMENT, status: 'cancelled', net_a_payer: 100 }, error: null }
  })

  it('checks the organization first, then calls cancel_devis with one argument', async () => {
    expect(await cancelDevis('org-1', DOCUMENT)).toEqual({ id: DOCUMENT, status: 'cancelled' })
    expect(db.calls).toEqual([
      { table: 'documents', select: 'id', filters: [['organization_id', 'org-1'], ['id', DOCUMENT]], order: [], limit: 0 },
      { rpc: 'cancel_devis', args: { p_devis_id: DOCUMENT } },
    ])
  })

  it('throws DF021 as it is', async () => {
    const error = { code: 'DF021', message: 'internal', details: null, hint: null }
    db.result = { data: null, error }
    await expect(cancelDevis('org-1', DOCUMENT)).rejects.toBe(error)
  })
})

describe('the new codes have a French message', () => {
  it.each(['DF018', 'DF019', 'DF021', 'DF024'])('%s', (code) => {
    const key = errorMessageKey({ code, message: 'internal' })
    expect(key).toBe(`errors.db.${code}`)
    expect((translations.errors.db as Record<string, string>)[code]).toMatch(/\S/)
  })
})
