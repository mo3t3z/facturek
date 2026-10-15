import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import translations from '../../locales/fr/translation.json'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'

// The payments block of an issued facture, "Annuler le devis" (P2e3) and "Créer la facture" (P2f).
// The real client is replaced by a recorder: no network, and every request is kept.
type Call = { table: string; op: 'select'; columns?: string; filters: Record<string, unknown> }
type Result = { data: unknown; error: object | null }

const api = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: vi.fn<(call: Call) => Result>(),
  rpc: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../../lib/supabase', () => {
  function from(table: string) {
    const call: Call = { table, op: 'select', filters: {} }
    api.calls.push(call)
    const run = () => Promise.resolve(api.respond(call))
    const query = {
      select: (columns: string) => {
        call.columns = columns
        return query
      },
      eq: (column: string, value: unknown) => {
        call.filters[column] = value
        return query
      },
      order: () => query,
      limit: () => query,
      single: run,
      maybeSingle: run,
      then: (onOk: (value: Result) => unknown, onError: (reason: unknown) => unknown) => run().then(onOk, onError),
    }
    return query
  }
  return { supabase: { from, rpc: api.rpc, auth: { signOut: api.signOut } } }
})

import { routes } from '../../app/router'

const ok = (data: unknown): Result => ({ data, error: null })
const dbError = (code: string) => ({ code, message: 'internal: payments exceed', details: null, hint: null })
const user = userEvent.setup({ delay: null })

const DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NEW_FACTURE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const line = { id: 'l1', position: 0, description: 'Prestation', quantity: '1.000', unit_price: '100.000', tva_rate: '0.000' }

// An issued facture of 100.000 (stored), with a timbre of 1.000: net à payer 101.000.
const facture = {
  id: DOC, type: 'facture', number: 3, year: 2026, status: 'sent', client_id: 'c1', issue_date: '2026-10-01', due_date: null, notes: null,
  seller_name: 'Vendeur', seller_matricule_fiscal: null, seller_address: null, buyer_name: 'Client', buyer_matricule_fiscal: null, buyer_address: null,
  total_ht: '100.000', total_tva: '0.000', total_ttc: '100.000', timbre_fiscal: '1.000', net_a_payer: '101.000',
  tva_breakdown: [{ rate: '0.000', base: '100.000', tva: '0.000' }],
}

let document: Record<string, unknown>
let payments: Record<string, unknown>[]
let rpcAnswer: (name: string, args: unknown) => Result
let rpcCalls: { name: string; args: unknown }[]
/** The facture made from the devis (findConvertedFacture), null when there is none. */
let converted: Record<string, unknown> | null

beforeEach(() => {
  vi.clearAllMocks()
  api.calls.length = 0
  document = { ...facture }
  payments = [{ id: 'p1', amount: '40.000', paid_at: '2026-10-05', method: 'virement' }]
  rpcCalls = []
  converted = null
  rpcAnswer = (name) =>
    name === 'record_payment' ? ok({ id: 'p-new', amount: 1.5 }) : name === 'convert_devis_to_facture' ? ok({ id: NEW_FACTURE, status: 'draft' }) : ok({ id: DOC, status: 'cancelled' })
  api.rpc.mockImplementation((name: string, args: unknown) => {
    if (name !== 'record_payment' && name !== 'cancel_devis' && name !== 'convert_devis_to_facture') return Promise.resolve(ok('org-1'))
    rpcCalls.push({ name, args })
    return Promise.resolve(rpcAnswer(name, args))
  })
  api.respond.mockImplementation((call) => {
    if (call.table === 'organizations') return ok({ id: 'org-1', name: 'Org', matricule_fiscal: null, address: null, email: null, phone: null })
    if (call.table === 'documents' && 'converted_from' in call.filters) return ok(converted)
    if (call.table === 'documents' && call.filters.id === NEW_FACTURE) return ok({ ...facture, id: NEW_FACTURE, status: 'draft', number: null, year: null })
    if (call.table === 'documents') return ok(document)
    if (call.table === 'payments') return ok(payments)
    return ok([line])
  })
})

const open = () => renderRoutes(routes, `/app/documents/${DOC}`, authState({ session: fakeSession() }))
const paymentsRegion = async () => {
  const region = await screen.findByRole('region', { name: 'Paiements' })
  await within(region).findByText(/Reste à payer/)
  return region
}
const row = (region: HTMLElement, label: string) => within(region).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
const paymentSelects = () => api.calls.filter((call) => call.table === 'payments')

async function fillAndCheck(region: HTMLElement, amount: string, method = 'Chèque') {
  await user.type(within(region).getByLabelText('Montant (TND)'), amount)
  await user.selectOptions(within(region).getByLabelText('Moyen de paiement'), method)
  await user.click(within(region).getByRole('button', { name: 'Vérifier le paiement' }))
}

describe('the payments block of an issued facture', () => {
  it('lists the payments and derives paid and remaining from the STORED net à payer, timbre included', async () => {
    open()
    const region = await paymentsRegion()
    expect(within(region).getByText(/05\/10\/2026 · Virement/)).toBeInTheDocument()
    expect(row(region, 'Net à payer')).toBe('101,000 TND')
    expect(row(region, 'Déjà payé')).toBe('40,000 TND')
    expect(row(region, 'Reste à payer')).toBe('61,000 TND')
  })

  it('reads the payments as text, for the organization and the document of the screen', async () => {
    open()
    await paymentsRegion()
    expect(paymentSelects()[0]).toMatchObject({ columns: 'id, amount::text, paid_at, method', filters: { organization_id: 'org-1', document_id: DOC } })
  })

  it('proposes an empty amount, a day as YYYY-MM-DD and no method: nothing is chosen for the user', async () => {
    open()
    const region = await paymentsRegion()
    expect(within(region).getByLabelText('Montant (TND)')).toHaveValue('')
    expect((within(region).getByLabelText('Date du paiement') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(within(region).getByLabelText('Moyen de paiement')).toHaveValue('')
  })

  it('refuses an amount above the remaining amount, and a missing method, before sending anything', async () => {
    open()
    const region = await paymentsRegion()
    await user.type(within(region).getByLabelText('Montant (TND)'), '61,001')
    await user.click(within(region).getByRole('button', { name: 'Vérifier le paiement' }))
    expect(await within(region).findByText('Le montant dépasse le reste à payer.')).toBeInTheDocument()
    expect(within(region).getByText('Choisissez le moyen de paiement.')).toBeInTheDocument()
    expect(within(region).queryByRole('group')).not.toBeInTheDocument()
    expect(rpcCalls).toEqual([])
  })

  it('opens a confirmation with the amount, the day, the method and the remaining amount before and after, on "Annuler"', async () => {
    open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '20,5')
    const group = within(region).getByRole('group', { name: 'Enregistrer ce paiement ?' })
    expect(row(group, 'Montant (TND)')).toBe('20,500 TND')
    expect(row(group, 'Moyen de paiement')).toBe('Chèque')
    expect(row(group, 'Reste à payer avant')).toBe('61,000 TND')
    expect(row(group, 'Reste à payer après')).toBe('40,500 TND')
    expect(within(group).getByRole('button', { name: 'Annuler' })).toHaveFocus()
    expect(rpcCalls).toEqual([])
  })

  it('cancelling the confirmation sends nothing', async () => {
    open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '20,5')
    await user.click(within(region).getByRole('button', { name: 'Annuler' }))
    expect(within(region).queryByRole('group')).not.toBeInTheDocument()
    expect(rpcCalls).toEqual([])
  })

  it('confirming sends the displayed amount AS TEXT with 3 decimals, then reloads the payments', async () => {
    open()
    const region = await paymentsRegion()
    const day = (within(region).getByLabelText('Date du paiement') as HTMLInputElement).value
    await fillAndCheck(region, '20,5')
    const before = paymentSelects().length
    await user.click(within(region).getByRole('button', { name: 'Enregistrer le paiement' }))
    expect(await within(region).findByText('Paiement enregistré.')).toBeInTheDocument()
    expect(rpcCalls).toEqual([{ name: 'record_payment', args: { p_document_id: DOC, p_amount: '20.500', p_paid_at: day, p_method: 'cheque' } }])
    await waitFor(() => expect(paymentSelects().length).toBeGreaterThan(before))
  })

  it('a double click sends ONE payment', async () => {
    let release: (value: Result) => void = () => {}
    rpcAnswer = () => new Promise<Result>((resolve) => { release = resolve }) as unknown as Result
    open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '1')
    const confirm = within(region).getByRole('button', { name: 'Enregistrer le paiement' })
    await user.dblClick(confirm)
    expect(rpcCalls).toHaveLength(1)
    release(ok({ id: 'p-new' }))
  })

  it('the second click of a double click that opened the confirmation does not confirm it', async () => {
    open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '1')
    // Where "Vérifier le paiement" was, "Enregistrer le paiement" may now be: a double click
    // would land its second click (detail 2) on it.
    fireEvent.click(within(region).getByRole('button', { name: 'Enregistrer le paiement' }), { detail: 2 })
    expect(rpcCalls).toEqual([])
    expect(within(region).getByRole('group', { name: 'Enregistrer ce paiement ?' })).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Enregistrer le paiement' }), { detail: 1 })
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
  })

  it('closes and says so when the payments change behind an open confirmation: nothing is sent', async () => {
    const { client } = open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '20,5')
    expect(row(within(region).getByRole('group'), 'Reste à payer avant')).toBe('61,000 TND')

    // Another tab recorded a payment; this tab gets the focus back and reloads the payments.
    payments = [...payments, { id: 'p2', amount: '10.000', paid_at: '2026-10-06', method: 'cash' }]
    await client.invalidateQueries({ queryKey: ['documents', 'org-1', 'payments', DOC] })

    expect(await within(region).findByText(/ont changé pendant la confirmation/)).toBeInTheDocument()
    // No confirmation left to click on, with the old remaining amount or with the new one.
    expect(within(region).queryByRole('group')).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'Enregistrer le paiement' })).not.toBeInTheDocument()
    expect(row(region, 'Reste à payer')).toBe('51,000 TND')
    expect(rpcCalls).toEqual([])
  })

  it('a reload that brings back the same payments leaves it open', async () => {
    const { client } = open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '20,5')
    await client.invalidateQueries({ queryKey: ['documents', 'org-1', 'payments', DOC] })
    await waitFor(() => expect(paymentSelects().length).toBeGreaterThan(1))
    expect(within(region).getByRole('group', { name: 'Enregistrer ce paiement ?' })).toBeInTheDocument()
  })

  it('DF018: says the payment exceeds the remaining amount and reloads the payments', async () => {
    rpcAnswer = () => ({ data: null, error: dbError('DF018') })
    open()
    const region = await paymentsRegion()
    await fillAndCheck(region, '1')
    const before = paymentSelects().length
    await user.click(within(region).getByRole('button', { name: 'Enregistrer le paiement' }))
    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent((translations.errors.db as Record<string, string>).DF018 as string)
    expect(alert).not.toHaveTextContent(/internal|exceed/)
    await waitFor(() => expect(paymentSelects().length).toBeGreaterThan(before))
  })

  it('a paid facture shows its payments and no form', async () => {
    document = { ...facture, status: 'paid' }
    payments = [{ id: 'p1', amount: '101.000', paid_at: '2026-10-05', method: 'virement' }]
    open()
    const region = await paymentsRegion()
    expect(within(region).getByText('Cette facture est entièrement payée.')).toBeInTheDocument()
    expect(row(region, 'Reste à payer')).toBe('0,000 TND')
    expect(within(region).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(region).queryByRole('button')).not.toBeInTheDocument()
  })

  it('payments above the stored net à payer: says so and shows no amount', async () => {
    payments = [{ id: 'p1', amount: '200.000', paid_at: '2026-10-05', method: 'virement' }]
    open()
    const region = await screen.findByRole('region', { name: 'Paiements' })
    expect(await within(region).findByText(/dépassent son net à payer/)).toBeInTheDocument()
    expect(within(region).queryByText(/TND/)).not.toBeInTheDocument()
    expect(within(region).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a devis has no payments block', async () => {
    document = { ...facture, type: 'devis', timbre_fiscal: null, net_a_payer: '100.000' }
    open()
    await screen.findByRole('region', { name: 'Totaux' })
    expect(screen.queryByRole('region', { name: 'Paiements' })).not.toBeInTheDocument()
    expect(paymentSelects()).toEqual([])
  })
})

describe('"Annuler le devis"', () => {
  beforeEach(() => {
    document = { ...facture, type: 'devis', timbre_fiscal: null, net_a_payer: '100.000' }
  })
  const cancelRegion = () => screen.findByRole('region', { name: 'Annulation' })

  it('asks first, on "Retour", and sends nothing', async () => {
    open()
    const region = await cancelRegion()
    await user.click(within(region).getByRole('button', { name: 'Annuler le devis' }))
    const group = within(region).getByRole('group', { name: 'Annuler ce devis ?' })
    expect(within(group).getByRole('button', { name: 'Retour' })).toHaveFocus()
    await user.click(within(group).getByRole('button', { name: 'Retour' }))
    expect(rpcCalls).toEqual([])
  })

  it('confirming calls cancel_devis with the id only, and reloads the document', async () => {
    open()
    const region = await cancelRegion()
    await user.click(within(region).getByRole('button', { name: 'Annuler le devis' }))
    const before = api.calls.filter((call) => call.table === 'documents').length
    await user.click(within(region).getByRole('button', { name: "Confirmer l'annulation" }))
    await waitFor(() => expect(rpcCalls).toEqual([{ name: 'cancel_devis', args: { p_devis_id: DOC } }]))
    await waitFor(() => expect(api.calls.filter((call) => call.table === 'documents').length).toBeGreaterThan(before))
  })

  it('the second click of a double click does not confirm the cancellation', async () => {
    open()
    const region = await cancelRegion()
    await user.click(within(region).getByRole('button', { name: 'Annuler le devis' }))
    fireEvent.click(within(region).getByRole('button', { name: "Confirmer l'annulation" }), { detail: 2 })
    expect(rpcCalls).toEqual([])
  })

  it('DF021: says a facture was made from this devis', async () => {
    rpcAnswer = () => ({ data: null, error: dbError('DF021') })
    open()
    const region = await cancelRegion()
    await user.click(within(region).getByRole('button', { name: 'Annuler le devis' }))
    await user.click(within(region).getByRole('button', { name: "Confirmer l'annulation" }))
    expect(await within(region).findByRole('alert')).toHaveTextContent((translations.errors.db as Record<string, string>).DF021 as string)
  })

  it.each([
    ['a cancelled devis', { status: 'cancelled' }],
    ['a facture', { type: 'facture' }],
  ])('is not offered on %s', async (_label, change) => {
    document = { ...document, ...change }
    open()
    await screen.findByRole('region', { name: 'Totaux' })
    expect(screen.queryByRole('region', { name: 'Annulation' })).not.toBeInTheDocument()
  })
})

describe('"Créer la facture" on a sent devis', () => {
  beforeEach(() => {
    document = { ...facture, type: 'devis', timbre_fiscal: null, net_a_payer: '100.000' }
  })
  const convertRegion = () => screen.findByRole('region', { name: 'Facture' })

  it('looks for the facture made from this devis, in the organization of the screen', async () => {
    open()
    await convertRegion()
    expect(api.calls.find((call) => call.table === 'documents' && 'converted_from' in call.filters)).toMatchObject({
      columns: 'id, number, year, status', filters: { organization_id: 'org-1', converted_from: DOC },
    })
  })

  it('asks first, lands on "Retour", and sends nothing', async () => {
    open()
    const region = await convertRegion()
    await user.click(within(region).getByRole('button', { name: 'Créer la facture' }))
    const group = within(region).getByRole('group', { name: 'Créer la facture de ce devis ?' })
    expect(within(group).getByText(/ne donne qu'une seule facture/)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Retour' })).toHaveFocus()
    await user.click(within(group).getByRole('button', { name: 'Retour' }))
    expect(rpcCalls).toEqual([])
  })

  it('confirming calls convert_devis_to_facture with the id only, then opens the new draft', async () => {
    open()
    const region = await convertRegion()
    await user.click(within(region).getByRole('button', { name: 'Créer la facture' }))
    await user.click(within(within(region).getByRole('group')).getByRole('button', { name: 'Créer la facture' }))
    await waitFor(() => expect(rpcCalls).toEqual([{ name: 'convert_devis_to_facture', args: { p_devis_id: DOC } }]))
    expect(await screen.findByRole('heading', { level: 1, name: 'Facture en brouillon' })).toBeInTheDocument()
  })

  it('the second click of a double click does not convert', async () => {
    open()
    const region = await convertRegion()
    await user.click(within(region).getByRole('button', { name: 'Créer la facture' }))
    fireEvent.click(within(within(region).getByRole('group')).getByRole('button', { name: 'Créer la facture' }), { detail: 2 })
    expect(rpcCalls).toEqual([])
  })

  it('DF025: says a facture already exists', async () => {
    rpcAnswer = () => ({ data: null, error: dbError('DF025') })
    open()
    const region = await convertRegion()
    await user.click(within(region).getByRole('button', { name: 'Créer la facture' }))
    await user.click(within(within(region).getByRole('group')).getByRole('button', { name: 'Créer la facture' }))
    expect(await within(region).findByRole('alert')).toHaveTextContent((translations.errors.db as Record<string, string>).DF025 as string)
  })

  it('once converted: links to the facture, offers neither the conversion nor the cancellation', async () => {
    converted = { id: NEW_FACTURE, number: null, year: null, status: 'draft' }
    open()
    const region = await convertRegion()
    expect(await within(region).findByText(/Une facture en brouillon a été créée à partir de ce devis\./)).toBeInTheDocument()
    expect(within(region).getByRole('link', { name: 'Ouvrir la facture' })).toHaveAttribute('href', `/app/documents/${NEW_FACTURE}`)
    expect(within(region).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Annulation' })).not.toBeInTheDocument()
  })

  it('shows the number of an issued facture made from it', async () => {
    converted = { id: NEW_FACTURE, number: 7, year: 2026, status: 'sent' }
    open()
    const region = await convertRegion()
    expect(await within(region).findByText(/La facture 2026-0007 \(Émise\) a été établie à partir de ce devis\./)).toBeInTheDocument()
  })
})
