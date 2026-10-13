import type { Client } from './api'

/** Lower case, without accents: "Société Élan" and "societe elan" compare equal. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

// A query made only of what a phone number is written with.
const PHONE_LIKE = /^[0-9\s.()+-]+$/
// Fewer digits than this would match almost every phone number.
const MIN_PHONE_DIGITS = 3

/**
 * The digits of a phone number, without the way it was typed: spaces, dots, dashes and
 * parentheses are dropped, and so is a leading Tunisian country code (+216 or 00216).
 * "+216 22 345 678", "22.345.678" and "(22) 345-678" all give "22345678".
 */
export function phoneDigits(text: string): string {
  return text
    .replace(/[\s.()-]/g, '')
    .replace(/^(?:\+|00)216/, '')
    .replace(/[^0-9]/g, '')
}

/** True when the query is a phone number (or a part of one) contained in the client's phone. */
function matchesPhone(client: Client, query: string): boolean {
  if (client.phone === null || !PHONE_LIKE.test(query)) return false
  const digits = phoneDigits(query)
  return digits.length >= MIN_PHONE_DIGITS && phoneDigits(client.phone).includes(digits)
}

/**
 * Filters the clients already loaded for the organization. Every word of the query must
 * appear in the name, the matricule fiscal, the e-mail or the phone number. A phone number
 * is also found whatever its spacing: "22345678" finds "22 345 678".
 * It runs in the browser: the user's text never becomes part of a database filter.
 */
export function filterClients(clients: readonly Client[], query: string): Client[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...clients]
  return clients.filter((client) => {
    if (matchesPhone(client, query.trim())) return true
    const haystack = normalize(
      [client.name, client.matricule_fiscal, client.email, client.phone].filter(Boolean).join(' '),
    )
    return words.every((word) => haystack.includes(word))
  })
}
