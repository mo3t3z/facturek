import { describe, expect, it } from 'vitest'
import type { Client } from './api'
import { filterClients } from './search'

const client = (overrides: Partial<Client>): Client => ({
  id: 'id',
  name: 'x',
  matricule_fiscal: null,
  address: null,
  email: null,
  phone: null,
  ...overrides,
})

const elan = client({ id: '1', name: 'Société Élan', matricule_fiscal: '1234567/A/M/000', email: 'contact@elan.tn' })
const bechir = client({ id: '2', name: 'Béchir Trabelsi', phone: '98 765 432', address: 'rue Élan' })
const all = [elan, bechir]

const names = (query: string) => filterClients(all, query).map((c) => c.name)

describe('filterClients', () => {
  it('returns everything for an empty or blank query, as a new array', () => {
    expect(filterClients(all, '')).toEqual(all)
    expect(filterClients(all, '   ')).toEqual(all)
    expect(filterClients(all, '')).not.toBe(all)
  })

  it('ignores case and accents, on both sides', () => {
    expect(names('SOCIETE')).toEqual(['Société Élan'])
    expect(names('béchir')).toEqual(['Béchir Trabelsi'])
    expect(names('bechir')).toEqual(['Béchir Trabelsi'])
  })

  it('looks in the name, the matricule fiscal, the e-mail and the phone', () => {
    expect(names('1234567/a')).toEqual(['Société Élan'])
    expect(names('contact@')).toEqual(['Société Élan'])
    expect(names('765')).toEqual(['Béchir Trabelsi'])
  })

  it('does not look in the address', () => {
    expect(names('rue')).toEqual([])
  })

  it('requires every word, in any order', () => {
    expect(names('elan societe')).toEqual(['Société Élan'])
    expect(names('elan trabelsi')).toEqual([])
  })

  it('treats the query as plain text, not as a pattern', () => {
    expect(names('.*')).toEqual([])
    expect(names('%')).toEqual([])
  })
})
