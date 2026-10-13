import { describe, expect, it } from 'vitest'
import type { Client } from './api'
import { filterClients, phoneDigits } from './search'

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

  describe('phone numbers', () => {
    const spaced = client({ id: '3', name: 'Garage', phone: '22 345 678' })
    const international = client({ id: '4', name: 'Export', phone: '+216 71.123.456' })
    const noPhone = client({ id: '5', name: 'Sans téléphone' })
    const phones = [spaced, international, noPhone, elan]
    const found = (query: string) => filterClients(phones, query).map((c) => c.name)

    it('finds a number typed without spaces, and with them', () => {
      expect(found('22345678')).toEqual(['Garage'])
      expect(found('22 345 678')).toEqual(['Garage'])
      expect(found('22 34 56 78')).toEqual(['Garage'])
      expect(found('345678')).toEqual(['Garage'])
    })

    it('ignores dots, dashes and parentheses on both sides', () => {
      expect(found('22.345.678')).toEqual(['Garage'])
      expect(found('(22) 345-678')).toEqual(['Garage'])
      expect(found('71123456')).toEqual(['Export'])
      expect(found('71 123 456')).toEqual(['Export'])
    })

    it('ignores a leading +216 or 00216 on both sides', () => {
      expect(found('+216 22 345 678')).toEqual(['Garage'])
      expect(found('0021622345678')).toEqual(['Garage'])
      expect(found('+21671123456')).toEqual(['Export'])
      expect(found('0021671123456')).toEqual(['Export'])
    })

    it('compares digits only from 3 digits on, so a short query does not match everything', () => {
      const one = (query: string) => filterClients([spaced], query).map((c) => c.name)
      const two = (query: string) => filterClients([spaced, international], query).map((c) => c.name)
      // "23", "56" and "223" sit across a space in "22 345 678": only digit matching finds them.
      expect(one('23')).toEqual([])
      expect(one('56')).toEqual([])
      expect(one('223')).toEqual(['Garage'])
      expect(one('2 2 3')).toEqual(['Garage'])
      // The country code alone, or with too few digits after it, is not a phone search.
      expect(two('+216')).toEqual(['Export'])
      expect(two('+216 22')).toEqual([])
      expect(two('+216 223')).toEqual(['Garage'])
    })

    it('needs the digits to follow each other in the number', () => {
      const names = (query: string) => filterClients([spaced], query).map((c) => c.name)
      expect(names('345678')).toEqual(['Garage'])
      expect(names('346')).toEqual([])
      expect(names('876543')).toEqual([])
    })

    it('keeps the name and the other fields as they were', () => {
      expect(found('garage')).toEqual(['Garage'])
      expect(found('garage 22345678')).toEqual([])
      expect(found('1234567/a')).toEqual(['Société Élan'])
    })
  })

  it('reduces a phone number to its digits', () => {
    expect(phoneDigits('+216 22 345 678')).toBe('22345678')
    expect(phoneDigits('00216 22.345.678')).toBe('22345678')
    expect(phoneDigits('(22) 345-678')).toBe('22345678')
    expect(phoneDigits('216 22 345 678')).toBe('21622345678')
    expect(phoneDigits('')).toBe('')
  })

  it('treats the query as plain text, not as a pattern', () => {
    expect(names('.*')).toEqual([])
    expect(names('%')).toEqual([])
  })
})
