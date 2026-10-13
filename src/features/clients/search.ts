import type { Client } from './api'

/** Lower case, without accents: "Société Élan" and "societe elan" compare equal. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Filters the clients already loaded for the organization. Every word of the query must
 * appear in the name, the matricule fiscal, the e-mail or the phone number.
 * It runs in the browser: the user's text never becomes part of a database filter.
 */
export function filterClients(clients: readonly Client[], query: string): Client[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...clients]
  return clients.filter((client) => {
    const haystack = normalize(
      [client.name, client.matricule_fiscal, client.email, client.phone].filter(Boolean).join(' '),
    )
    return words.every((word) => haystack.includes(word))
  })
}
