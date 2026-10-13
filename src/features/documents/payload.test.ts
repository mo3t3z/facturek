import { describe, expect, it } from 'vitest'
import { formatDay, isBeforeDay, isIsoDay } from './dates'
import { formatDocumentNumber } from './format'
import { draftInsertPayload, draftUpdatePayload } from './payload'
import { type NewDraftValues, newDraftSchema } from './schemas'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const values: NewDraftValues = { type: 'facture', client_id: CLIENT, issue_date: '2026-10-13', due_date: '2026-11-12', notes: 'Merci' }

// What the API role may write (grants of 20261012210007_documents.sql).
const INSERTABLE = ['organization_id', 'type', 'client_id', 'issue_date', 'due_date', 'notes']
const UPDATABLE = ['client_id', 'issue_date', 'due_date', 'notes']
const SERVER_ONLY = ['id', 'status', 'number', 'year', 'currency', 'seller_name', 'buyer_name', 'timbre_fiscal', 'created_at', 'updated_at']

describe('draftInsertPayload', () => {
  it('has exactly the columns the API role may insert', () => {
    expect(Object.keys(draftInsertPayload('org-1', values)).sort()).toEqual([...INSERTABLE].sort())
  })

  it('never sends status, number, year or any column written by the database', () => {
    const payload = draftInsertPayload('org-1', values)
    for (const column of SERVER_ONLY) expect(payload).not.toHaveProperty(column)
  })

  it('does not copy anything else that the caller may carry', () => {
    const polluted = { ...values, status: 'sent', number: 1, year: 2026, id: 'x' } as NewDraftValues
    expect(Object.keys(draftInsertPayload('org-1', polluted)).sort()).toEqual([...INSERTABLE].sort())
  })

  it('sends the values as they are, and empty dates and notes as NULL', () => {
    expect(draftInsertPayload('org-1', values)).toStrictEqual({
      organization_id: 'org-1',
      type: 'facture',
      client_id: CLIENT,
      issue_date: '2026-10-13',
      due_date: '2026-11-12',
      notes: 'Merci',
    })
    expect(draftInsertPayload('org-1', { ...values, issue_date: '', due_date: '', notes: '' })).toMatchObject({
      issue_date: null,
      due_date: null,
      notes: null,
    })
  })
})

describe('draftUpdatePayload', () => {
  it('has exactly the columns the API role may update: never the type, the organization or the status', () => {
    expect(Object.keys(draftUpdatePayload(values)).sort()).toEqual([...UPDATABLE].sort())
    const polluted = { ...values, status: 'sent', organization_id: 'other' } as NewDraftValues
    expect(Object.keys(draftUpdatePayload(polluted)).sort()).toEqual([...UPDATABLE].sort())
  })

  it('sends empty dates and notes as NULL', () => {
    expect(draftUpdatePayload({ ...values, issue_date: '', due_date: '', notes: '' })).toStrictEqual({
      client_id: CLIENT,
      issue_date: null,
      due_date: null,
      notes: null,
    })
  })
})

describe('newDraftSchema', () => {
  const input = { type: 'devis', client_id: CLIENT, issue_date: '', due_date: '', notes: '' }
  const messages = (candidate: object) => {
    const result = newDraftSchema.safeParse(candidate)
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('accepts a draft with only a type and a client', () => {
    expect(messages(input)).toEqual([])
  })

  it('requires a known type and a client', () => {
    expect(messages({ ...input, type: '' })).toEqual(['type: documents.validation.typeRequired'])
    expect(messages({ ...input, type: 'avoir' })).toEqual(['type: documents.validation.typeRequired'])
    expect(messages({ ...input, client_id: '' })).toEqual(['client_id: documents.validation.clientRequired'])
  })

  it('refuses a due date before the issue date, and accepts the same day', () => {
    expect(messages({ ...input, issue_date: '2026-10-13', due_date: '2026-10-12' })).toEqual(['due_date: documents.validation.dueBeforeIssue'])
    expect(messages({ ...input, issue_date: '2026-10-13', due_date: '2026-10-13' })).toEqual([])
    expect(messages({ ...input, issue_date: '2026-12-31', due_date: '2027-01-01' })).toEqual([])
    // One date alone cannot be compared.
    expect(messages({ ...input, due_date: '2020-01-01' })).toEqual([])
  })

  it('refuses a date that is not a real day', () => {
    expect(messages({ ...input, issue_date: '2026-02-30' })).toEqual(['issue_date: documents.validation.dateInvalid'])
    expect(messages({ ...input, due_date: '13/10/2026' })).toEqual(['due_date: documents.validation.dateInvalid'])
  })

  it('trims the notes and limits their length', () => {
    expect(newDraftSchema.parse({ ...input, notes: '  Merci  ' }).notes).toBe('Merci')
    expect(messages({ ...input, notes: 'x'.repeat(2001) })).toEqual(['notes: validation.tooLong'])
  })
})

describe('dates as plain text', () => {
  it.each(['2026-10-13', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01'])('accepts the real day %s', (day) => {
    expect(isIsoDay(day)).toBe(true)
  })

  it.each(['', '2026-02-29', '1900-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32',
    '0000-01-01', '2026-1-3', '13/10/2026', '2026-10-13T00:00:00Z', ' 2026-10-13', '2026-10-13 ', '٢٠٢٦-١٠-١٣'])(
    'refuses %j',
    (text) => {
      expect(isIsoDay(text)).toBe(false)
    },
  )

  it('compares days as text', () => {
    expect(isBeforeDay('2026-10-12', '2026-10-13')).toBe(true)
    expect(isBeforeDay('2026-10-13', '2026-10-13')).toBe(false)
    expect(isBeforeDay('2026-09-30', '2026-10-01')).toBe(true)
    expect(isBeforeDay('2027-01-01', '2026-12-31')).toBe(false)
  })

  it('shows a day in French order without moving it', () => {
    expect(formatDay('2026-10-13')).toBe('13/10/2026')
    // The first day of a year and of a month: where a UTC conversion would show the day before.
    expect(formatDay('2026-01-01')).toBe('01/01/2026')
    expect(formatDay('2026-03-01')).toBe('01/03/2026')
    expect(formatDay('not a date')).toBe('not a date')
  })
})

describe('formatDocumentNumber', () => {
  it('shows the year and the number on 4 digits, and nothing for a draft', () => {
    expect(formatDocumentNumber(2026, 1)).toBe('2026-0001')
    expect(formatDocumentNumber(2026, 42)).toBe('2026-0042')
    expect(formatDocumentNumber(2026, 9999)).toBe('2026-9999')
    expect(formatDocumentNumber(2026, 12345)).toBe('2026-12345')
    expect(formatDocumentNumber(null, null)).toBeNull()
    expect(formatDocumentNumber(2026, null)).toBeNull()
    expect(formatDocumentNumber(null, 1)).toBeNull()
  })
})
