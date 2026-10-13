import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { millimes, qtyMilli, rateMilli } from '../../lib/money/money'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'
import { readItem } from './itemSchema'
import { itemInsertPayload, itemUpdatePayload } from './payload'
import { previewLines, previewLineTotal, previewTimbre, previewTotals } from './preview'

// The real client is replaced by a recorder: no network, and every query is kept.
type Call = {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  columns?: string
  payload?: Record<string, unknown>
  filters: Record<string, unknown>
  order?: string[]
  limit?: number
  ending?: 'single' | 'maybeSingle'
}
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
    const end = (ending: 'single' | 'maybeSingle') => () => {
      call.ending = ending
      return run()
    }
    const write = (op: Call['op']) => (payload?: Record<string, unknown>) => {
      call.op = op
      if (payload) call.payload = payload
      return query
    }
    const query = {
      select: (columns: string) => {
        call.columns = columns
        return query
      },
      insert: write('insert'),
      update: write('update'),
      delete: write('delete'),
      eq: (column: string, value: unknown) => {
        call.filters[column] = value
        return query
      },
      order: (column: string) => {
        call.order = [...(call.order ?? []), column]
        return query
      },
      limit: (count: number) => {
        call.limit = count
        return query
      },
      single: end('single'),
      maybeSingle: end('maybeSingle'),
      then: (onOk: (value: Result) => unknown, onError: (reason: unknown) => unknown) => run().then(onOk, onError),
    }
    return query
  }
  return { supabase: { from, rpc: api.rpc, auth: { signOut: api.signOut } } }
})

import { routes } from '../../app/router'

const ok = (data: unknown): Result => ({ data, error: null })
const failed = (error: object): Result => ({ data: null, error })
const NO_ROW = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }
const user = userEvent.setup({ delay: null })
const NBSP = ' '

const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT = '11111111-1111-4111-8111-111111111111'
const LINE_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const LINE_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'

// As PostgREST returns them with ::text.
const lineA = { id: LINE_A, position: 0, description: 'Installation', quantity: '2.000', unit_price: '10.000', tva_rate: '19.000' }
const lineB = { id: LINE_B, position: 3, description: 'Câble', quantity: '1.000', unit_price: '5.000', tva_rate: '7.000' }

let document: Record<string, unknown>
let lines: Record<string, unknown>[]
let tax: Record<string, unknown> | null
let override: (call: Call) => Result | undefined

beforeEach(() => {
  vi.clearAllMocks()
  api.calls.length = 0
  document = {
    id: DOC, type: 'facture', number: null, year: null, status: 'draft', client_id: CLIENT, issue_date: null, due_date: null,
    notes: null, buyer_name: null, buyer_matricule_fiscal: null, buyer_address: null,
  }
  lines = [lineA, lineB]
  tax = { organization_id: 'org-1', default_tva_rate: '19.000', timbre_enabled: true, timbre_fiscal: '1.000' }
  override = () => undefined
  api.rpc.mockResolvedValue(ok('org-1'))
  api.respond.mockImplementation((call) => {
    const special = override(call)
    if (special) return special
    if (call.table === 'organizations') return ok({ id: 'org-1', name: 'Atelier Amel' })
    if (call.table === 'clients') return ok([{ id: CLIENT, name: 'Société Élan', matricule_fiscal: null, address: null, email: null, phone: null }])
    if (call.table === 'tax_settings') return ok(tax)
    if (call.table === 'documents') return ok(call.op === 'select' ? document : { id: DOC })
    if (call.op === 'select') return ok(lines)
    return ok({ id: call.filters.id ?? 'new-line' })
  })
})

const open = () => renderRoutes(routes, `/app/documents/${DOC}`, authState({ session: fakeSession() }))
const itemCalls = (op: Call['op']) => api.calls.filter((call) => call.table === 'document_items' && call.op === op)
const addForm = () => screen.findByRole('form', { name: 'Ajouter une ligne' })
const preview = () => screen.findByRole('region', { name: /^Totaux/ })
const field = (form: HTMLElement, label: string | RegExp) => within(form).getByLabelText(label)
const total = (region: HTMLElement, label: string) => within(region).getByText(label, { selector: 'dt' }).nextElementSibling

async function fill(form: HTMLElement, values: { description?: string; quantity?: string; price?: string; rate?: string }) {
  if (values.description !== undefined) await user.type(field(form, 'Désignation'), values.description)
  if (values.quantity !== undefined) await user.type(field(form, 'Quantité'), values.quantity)
  if (values.price !== undefined) await user.type(field(form, 'Prix unitaire HT (TND)'), values.price)
  if (values.rate !== undefined) {
    await user.clear(field(form, 'Taux de TVA (%)'))
    if (values.rate !== '') await user.type(field(form, 'Taux de TVA (%)'), values.rate)
  }
}

describe('lines of a draft', () => {
  it('reads the lines of this document in this organization, numerics as text, in document order', async () => {
    open()
    await addForm()
    expect(itemCalls('select')).toEqual([
      {
        table: 'document_items',
        op: 'select',
        columns: 'id, position, description, quantity::text, unit_price::text, tva_rate::text',
        filters: { organization_id: 'org-1', document_id: DOC },
        order: ['position', 'created_at', 'id'],
        limit: 1000,
      },
    ])
  })

  it('shows each line with its quantity, price, rate and total HT', async () => {
    open()
    await addForm()
    expect(screen.getByText('2 lignes')).toBeInTheDocument()
    const first = screen.getByText('Installation').closest('li') as HTMLElement
    expect(within(first).getByText('Quantité').nextElementSibling).toHaveTextContent('2')
    expect(within(first).getByText('Prix unitaire HT').nextElementSibling).toHaveTextContent('10,000 TND')
    expect(within(first).getByText('TVA').nextElementSibling).toHaveTextContent('19 %')
    expect(within(first).getByText('Total HT').nextElementSibling).toHaveTextContent('20,000 TND')
    const second = screen.getByText('Câble').closest('li') as HTMLElement
    expect(within(second).getByText('TVA').nextElementSibling).toHaveTextContent('7 %')
    expect(within(second).getByText('Total HT').nextElementSibling).toHaveTextContent('5,000 TND')
  })

  it('says so when the draft has no line yet', async () => {
    lines = []
    open()
    await addForm()
    expect(screen.getByText(/^Aucune ligne pour le moment\./)).toBeInTheDocument()
  })

  it('renders a hostile description as plain text', async () => {
    const hostile = '<img src=x onerror=alert(1)><b>Ligne</b>'
    lines = [{ ...lineA, description: hostile }]
    const { container } = open()
    await addForm()
    expect(screen.getByText(hostile)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })
})

describe('adding a line', () => {
  it('proposes the default TVA rate of the settings and inserts the line after the last one, numerics as strings', async () => {
    open()
    const form = await addForm()
    expect(field(form, 'Taux de TVA (%)')).toHaveValue('19')
    await fill(form, { description: '  Main d’œuvre  ', quantity: '1,5', price: '100' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))

    await waitFor(() => expect(itemCalls('insert')).toHaveLength(1))
    const [insert] = itemCalls('insert')
    expect(insert).toEqual({
      table: 'document_items',
      op: 'insert',
      filters: {},
      columns: 'id',
      ending: 'single',
      payload: {
        organization_id: 'org-1',
        document_id: DOC,
        // After the last line, whose position is 3.
        position: 4,
        description: 'Main d’œuvre',
        quantity: '1.500',
        unit_price: '100.000',
        tva_rate: '19.000',
      },
    })
    for (const column of ['quantity', 'unit_price', 'tva_rate']) expect(typeof insert?.payload?.[column]).toBe('string')
    // A fresh, empty form is ready for the next line.
    await waitFor(async () => expect(field(await addForm(), 'Désignation')).toHaveValue(''))
  })

  it('gives the first line the position 0', async () => {
    lines = []
    open()
    const form = await addForm()
    await fill(form, { description: 'Première', quantity: '1', price: '1' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    await waitFor(() => expect(itemCalls('insert')).toHaveLength(1))
    expect(itemCalls('insert')[0]?.payload).toMatchObject({ position: 0 })
  })

  it('assumes no rate when the settings have none: the field is empty and required', async () => {
    tax = { organization_id: 'org-1', default_tva_rate: null, timbre_enabled: false, timbre_fiscal: null }
    open()
    const form = await addForm()
    const rate = field(form, 'Taux de TVA (%)')
    expect(rate).toHaveValue('')
    expect(rate).not.toHaveAttribute('placeholder')
    expect(rate).toHaveAccessibleDescription(/Aucun taux par défaut n'est défini dans les paramètres/)
    await fill(form, { description: 'Sans taux', quantity: '1', price: '10' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    expect(rate).toBeInvalid()
    expect(rate).toHaveAccessibleDescription(/Indiquez le taux de TVA de cette ligne \(0 si elle ne porte pas de TVA\)\./)
    expect(itemCalls('insert')).toEqual([])

    await user.type(rate, '0')
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    await waitFor(() => expect(itemCalls('insert')).toHaveLength(1))
    expect(itemCalls('insert')[0]?.payload).toMatchObject({ tva_rate: '0.000' })
  })

  it('refuses an empty description, a zero quantity and an unreadable price, in French, without calling the database', async () => {
    open()
    const form = await addForm()
    await fill(form, { description: '   ', quantity: '0', price: '1 500' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    expect(field(form, 'Désignation')).toHaveAccessibleDescription('Indiquez la désignation de la ligne.')
    expect(field(form, 'Quantité')).toHaveAccessibleDescription(/La quantité doit être supérieure à zéro\./)
    expect(field(form, 'Prix unitaire HT (TND)')).toHaveAccessibleDescription(/Montant invalide\./)
    expect(itemCalls('insert')).toEqual([])
  })

  it('requires a quantity and a price, and refuses more than 3 decimals', async () => {
    open()
    const form = await addForm()
    await fill(form, { description: 'Ligne' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    expect(field(form, 'Quantité')).toHaveAccessibleDescription(/Indiquez la quantité\./)
    expect(field(form, 'Prix unitaire HT (TND)')).toHaveAccessibleDescription(/Indiquez le prix unitaire/)
    await fill(form, { quantity: '1,2345', price: '10' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    expect(field(form, 'Quantité')).toHaveAccessibleDescription(/Quantité invalide\./)
    expect(itemCalls('insert')).toEqual([])
  })

  it('shows each value as it was understood once the field is left', async () => {
    open()
    const form = await addForm()
    await fill(form, { quantity: '1.500', price: '1500' })
    // Leave the price, then the rate: a field shows its reading once it is left.
    await user.tab()
    await user.tab()
    expect(field(form, 'Quantité')).toHaveAccessibleDescription(/= 1,5$/)
    expect(field(form, 'Prix unitaire HT (TND)')).toHaveAccessibleDescription(new RegExp(`= 1${NBSP}500,000 TND$`))
    expect(field(form, 'Taux de TVA (%)')).toHaveAccessibleDescription(/= 19 %$/)
    expect(field(form, 'Quantité')).toHaveAttribute('inputmode', 'decimal')
  })

  it('says the lines can no longer change when the document was issued meanwhile (DF014)', async () => {
    override = (call) =>
      call.table === 'document_items' && call.op === 'insert' ? failed({ code: 'DF014', message: 'the items of a sent document cannot be changed' }) : undefined
    open()
    const form = await addForm()
    await fill(form, { description: 'Trop tard', quantity: '1', price: '1' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent("Les lignes d'un document émis ne peuvent plus être modifiées.")
    expect(screen.queryByText(/the items of a sent document/)).not.toBeInTheDocument()
    // What was typed is still there.
    expect(field(form, 'Désignation')).toHaveValue('Trop tard')
  })
})

describe('editing a line', () => {
  it('opens the stored values and updates that line only, with exactly the editable columns', async () => {
    open()
    await addForm()
    await user.click(screen.getByRole('button', { name: 'Modifier la ligne 1 : Installation' }))
    const form = screen.getByRole('form', { name: 'Modifier la ligne 1' })
    expect(field(form, 'Désignation')).toHaveValue('Installation')
    expect(field(form, 'Quantité')).toHaveValue('2,000')
    expect(field(form, 'Prix unitaire HT (TND)')).toHaveValue('10,000')
    expect(field(form, 'Taux de TVA (%)')).toHaveValue('19')
    // One form at a time.
    expect(screen.queryByRole('form', { name: 'Ajouter une ligne' })).not.toBeInTheDocument()

    await user.clear(field(form, 'Quantité'))
    await user.type(field(form, 'Quantité'), '3')
    await user.click(within(form).getByRole('button', { name: 'Enregistrer la ligne' }))

    await waitFor(() => expect(itemCalls('update')).toHaveLength(1))
    expect(itemCalls('update')[0]).toEqual({
      table: 'document_items',
      op: 'update',
      payload: { description: 'Installation', quantity: '3.000', unit_price: '10.000', tva_rate: '19.000' },
      filters: { organization_id: 'org-1', document_id: DOC, id: LINE_A },
      columns: 'id',
      ending: 'single',
    })
    expect(await addForm()).toBeInTheDocument()
  })

  it('can be cancelled without writing anything', async () => {
    open()
    await addForm()
    await user.click(screen.getByRole('button', { name: 'Modifier la ligne 2 : Câble' }))
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('form', { name: /Modifier la ligne/ })).not.toBeInTheDocument()
    expect(itemCalls('update')).toEqual([])
    expect(await addForm()).toBeInTheDocument()
  })

  it('says nothing was changed when the update matched no row (PGRST116)', async () => {
    override = (call) => (call.table === 'document_items' && call.op === 'update' ? failed(NO_ROW) : undefined)
    open()
    await addForm()
    await user.click(screen.getByRole('button', { name: 'Modifier la ligne 1 : Installation' }))
    const form = screen.getByRole('form', { name: 'Modifier la ligne 1' })
    await user.click(within(form).getByRole('button', { name: 'Enregistrer la ligne' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      "Rien n'a été modifié : cette ligne n'existe plus, ou le document n'est plus un brouillon.",
    )
    expect(screen.queryByText(/JSON object|0 rows/)).not.toBeInTheDocument()
  })
})

describe('removing a line', () => {
  it('asks for a confirmation, then deletes that line of this document', async () => {
    open()
    await addForm()
    await user.click(screen.getByRole('button', { name: 'Supprimer la ligne 2 : Câble' }))
    expect(screen.getByText('Supprimer la ligne 2 (Câble) ?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus()
    expect(itemCalls('delete')).toEqual([])
    override = (call) => {
      if (call.table === 'document_items' && call.op === 'delete') lines = lines.filter((line) => line.id !== call.filters.id)
      return undefined
    }
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    expect(await screen.findByText('1 ligne')).toBeInTheDocument()
    expect(itemCalls('delete')).toEqual([
      { table: 'document_items', op: 'delete', filters: { organization_id: 'org-1', document_id: DOC, id: LINE_B }, columns: 'id', ending: 'single' },
    ])
  })

  it('says nothing was changed when the delete matched no row (PGRST116)', async () => {
    override = (call) => (call.table === 'document_items' && call.op === 'delete' ? failed(NO_ROW) : undefined)
    open()
    await addForm()
    await user.click(screen.getByRole('button', { name: 'Supprimer la ligne 1 : Installation' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    expect(await screen.findByText(/^Rien n'a été modifié : cette ligne n'existe plus/)).toBeInTheDocument()
  })
})

describe('totals preview', () => {
  it('is clearly a preview, with the accountant note', async () => {
    open()
    const region = await preview()
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('Aperçu, non enregistré')
    expect(within(region).getByRole('note')).toHaveTextContent(/à faire vérifier par votre comptable\. La retenue à la source n'est pas prise en compte\./)
    expect(region).toHaveTextContent(/Les totaux officiels seront calculés et enregistrés à l'émission/)
  })

  it('shows the totals by rate, HT, TVA, the timbre of a facture and the TTC', async () => {
    open()
    const region = await preview()
    // 19 %: base 20.000, TVA 3.800. 7 %: base 5.000, TVA 0.350.
    const rows = within(region).getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual(['TauxBase HTTVA', '7 %5,000 TND0,350 TND', '19 %20,000 TND3,800 TND'])
    expect(total(region, 'Total HT')).toHaveTextContent('25,000 TND')
    expect(total(region, 'Total TVA')).toHaveTextContent('4,150 TND')
    expect(total(region, 'Timbre fiscal')).toHaveTextContent('1,000 TND')
    expect(total(region, 'Total TTC')).toHaveTextContent('30,150 TND')
  })

  it('never shows the timbre on a devis, even when the organization applies it', async () => {
    document = { ...document, type: 'devis' }
    open()
    const region = await preview()
    expect(within(region).queryByText('Timbre fiscal')).not.toBeInTheDocument()
    expect(total(region, 'Total TTC')).toHaveTextContent('29,150 TND')
  })

  it('shows no timbre on a facture when the organization does not apply it', async () => {
    tax = { ...tax, timbre_enabled: false }
    open()
    const region = await preview()
    expect(within(region).queryByText('Timbre fiscal')).not.toBeInTheDocument()
    expect(total(region, 'Total TTC')).toHaveTextContent('29,150 TND')
  })

  it('warns when the timbre is applied but has no amount, and does not count it', async () => {
    tax = { ...tax, timbre_fiscal: null }
    open()
    const region = await preview()
    expect(region).toHaveTextContent(/Le timbre fiscal est activé mais son montant n'est pas renseigné/)
    expect(within(region).queryByText('Timbre fiscal')).not.toBeInTheDocument()
    expect(total(region, 'Total TTC')).toHaveTextContent('29,150 TND')
  })

  it('rounds each line before adding them, and the TVA once per rate', async () => {
    tax = { ...tax, timbre_enabled: false }
    // 0.001 x 0.500 = 0.0005 -> 0.001 per line: HT 0.003 (0.0015 unrounded would give 0.002).
    // 1 x 0.003 at 19 %, three times: base 0.009 -> TVA 0.002 (0.001 per line would give 0.003).
    lines = [
      ...[1, 2, 3].map((n) => ({ id: `h${n}`, position: n, description: `Demi ${n}`, quantity: '0.001', unit_price: '0.500', tva_rate: '0.000' })),
      ...[4, 5, 6].map((n) => ({ id: `t${n}`, position: n, description: `Trois ${n}`, quantity: '1.000', unit_price: '0.003', tva_rate: '19.000' })),
    ]
    open()
    const region = await preview()
    const rows = within(region).getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual(['TauxBase HTTVA', '0 %0,003 TND0,000 TND', '19 %0,009 TND0,002 TND'])
    expect(total(region, 'Total HT')).toHaveTextContent('0,012 TND')
    expect(total(region, 'Total TVA')).toHaveTextContent('0,002 TND')
    expect(total(region, 'Total TTC')).toHaveTextContent('0,014 TND')
  })

  it('follows the line being typed, and says it is not saved', async () => {
    open()
    const region = await preview()
    const form = await addForm()
    await fill(form, { description: 'En cours', quantity: '2', price: '50' })
    // 19 % (default): base 20.000 + 100.000, TVA 22.800.
    await waitFor(() => expect(total(region, 'Total HT')).toHaveTextContent('125,000 TND'))
    expect(total(region, 'Total TVA')).toHaveTextContent('23,150 TND')
    expect(total(region, 'Total TTC')).toHaveTextContent('149,150 TND')
    expect(region).toHaveTextContent(/La ligne en cours de saisie est comptée dans l'aperçu, mais elle n'est pas encore enregistrée\./)
    expect(itemCalls('insert')).toEqual([])
    expect(api.calls.filter((call) => call.op !== 'select')).toEqual([])
  })

  it('ignores an incomplete or invalid line, says so, and never shows NaN', async () => {
    open()
    const region = await preview()
    const form = await addForm()
    await fill(form, { description: 'Incomplète', quantity: 'abc' })
    await waitFor(() => expect(region).toHaveTextContent(/La ligne en cours de saisie est incomplète ou invalide : elle n'est pas comptée/))
    expect(total(region, 'Total HT')).toHaveTextContent('25,000 TND')
    expect(total(region, 'Total TTC')).toHaveTextContent('30,150 TND')
    await fill(form, { price: '1e3', rate: '' })
    expect(total(region, 'Total TTC')).toHaveTextContent('30,150 TND')
    expect(window.document.body).not.toHaveTextContent(/NaN|undefined|Infinity|null/)
  })

  it('follows the line being edited, and returns to the saved values when the edit is cancelled', async () => {
    open()
    const region = await preview()
    await user.click(screen.getByRole('button', { name: 'Modifier la ligne 1 : Installation' }))
    const form = screen.getByRole('form', { name: 'Modifier la ligne 1' })
    await user.clear(field(form, 'Quantité'))
    // An incomplete edit keeps the saved values of that line.
    await waitFor(() => expect(region).toHaveTextContent(/incomplète ou invalide/))
    expect(total(region, 'Total HT')).toHaveTextContent('25,000 TND')
    await user.type(field(form, 'Quantité'), '10')
    await waitFor(() => expect(total(region, 'Total HT')).toHaveTextContent('105,000 TND'))
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(total(region, 'Total HT')).toHaveTextContent('25,000 TND'))
    expect(region).not.toHaveTextContent(/en cours de saisie/)
  })

  it.each(['facture', 'devis'])('still shows the totals of a %s, without a timbre, when the organization has no tax_settings row', async (type) => {
    document = { ...document, type }
    tax = null
    open()
    const region = await preview()
    const rows = within(region).getAllByRole('row').map((row) => row.textContent)
    expect(rows).toEqual(['TauxBase HTTVA', '7 %5,000 TND0,350 TND', '19 %20,000 TND3,800 TND'])
    expect(total(region, 'Total HT')).toHaveTextContent('25,000 TND')
    expect(total(region, 'Total TVA')).toHaveTextContent('4,150 TND')
    expect(total(region, 'Total TTC')).toHaveTextContent('29,150 TND')
    expect(within(region).queryByText('Timbre fiscal')).not.toBeInTheDocument()
    expect(region).not.toHaveTextContent(/timbre fiscal est activé/)
    // No default rate either: the field is empty and required.
    const form = await addForm()
    const rate = field(form, 'Taux de TVA (%)')
    expect(rate).toHaveValue('')
    expect(rate).toHaveAccessibleDescription(/Aucun taux par défaut n'est défini dans les paramètres/)
    await fill(form, { description: 'Sans paramètres', quantity: '1', price: '10' })
    await user.click(within(form).getByRole('button', { name: 'Ajouter la ligne' }))
    expect(rate).toBeInvalid()
    expect(rate).toHaveAccessibleDescription(/Indiquez le taux de TVA de cette ligne/)
    expect(itemCalls('insert')).toEqual([])
  })

  it('shows zeros for a draft without lines', async () => {
    lines = []
    tax = { ...tax, timbre_enabled: false }
    open()
    const region = await preview()
    expect(within(region).queryByRole('table')).not.toBeInTheDocument()
    expect(total(region, 'Total HT')).toHaveTextContent('0,000 TND')
    expect(total(region, 'Total TTC')).toHaveTextContent('0,000 TND')
  })

  it('says the amounts are too large instead of showing a number', async () => {
    lines = [{ ...lineA, quantity: '999999999.999', unit_price: '999999999.999' }]
    open()
    const region = await preview()
    expect(within(region).getByRole('alert')).toHaveTextContent(/Les montants dépassent la valeur maximale possible/)
    expect(within(region).queryByText('Total TTC')).not.toBeInTheDocument()
    expect(within(screen.getByText('Installation').closest('li') as HTMLElement).getByText('Total HT').nextElementSibling).toHaveTextContent('—')
  })

  it('writes nothing: opening the page only reads', async () => {
    open()
    await preview()
    expect(api.calls.filter((call) => call.op !== 'select')).toEqual([])
  })
})

describe('lines of a document that is no longer a draft', () => {
  beforeEach(() => {
    document = { ...document, status: 'sent', number: 7, year: 2026, issue_date: '2026-10-13', buyer_name: 'Société Élan' }
  })

  it('are shown read-only: no form, no button, no preview', async () => {
    open()
    expect(await screen.findByText('Installation')).toBeInTheDocument()
    expect(screen.getByText('2 lignes')).toBeInTheDocument()
    expect(within(screen.getByText('Câble').closest('li') as HTMLElement).getByText('Total HT').nextElementSibling).toHaveTextContent('5,000 TND')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Modifier|Supprimer|Ajouter|Enregistrer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Totaux/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Aperçu, non enregistré')).not.toBeInTheDocument()
    // The tax settings are not even read: nothing is computed from today's settings.
    expect(api.calls.filter((call) => call.table === 'tax_settings')).toEqual([])
  })

  it('says so when it has no line', async () => {
    lines = []
    open()
    expect(await screen.findByText('Ce document ne contient aucune ligne.')).toBeInTheDocument()
  })
})

// --- pure parts ---------------------------------------------------------------------------------
const values = { description: 'Ligne', quantity: qtyMilli(1500), unitPrice: millimes(1234567891), tvaRate: rateMilli(7500) }

describe('line payloads', () => {
  it('insert: exactly the columns the API role may insert, numerics as strings', () => {
    const payload = itemInsertPayload('org-1', DOC, 4, values)
    expect(Object.keys(payload).sort()).toEqual(['description', 'document_id', 'organization_id', 'position', 'quantity', 'tva_rate', 'unit_price'])
    expect(payload).toStrictEqual({
      organization_id: 'org-1',
      document_id: DOC,
      position: 4,
      description: 'Ligne',
      quantity: '1.500',
      unit_price: '1234567.891',
      tva_rate: '7.500',
    })
    // The organization and the document are not swapped.
    expect(itemInsertPayload('ORG', 'DOC', 0, values)).toMatchObject({ organization_id: 'ORG', document_id: 'DOC' })
  })

  it('update: exactly description, quantity, unit_price, tva_rate; never the document, the organization or the position', () => {
    const payload = itemUpdatePayload(values)
    expect(Object.keys(payload).sort()).toEqual(['description', 'quantity', 'tva_rate', 'unit_price'])
    expect(JSON.stringify(payload)).toBe('{"description":"Ligne","quantity":"1.500","unit_price":"1234567.891","tva_rate":"7.500"}')
  })

  it('never sends a computed value', () => {
    for (const payload of [itemInsertPayload('org-1', DOC, 0, values), itemUpdatePayload(values)]) {
      for (const column of ['id', 'total', 'total_ht', 'line_total_ht', 'tva', 'created_at', 'updated_at']) expect(payload).not.toHaveProperty(column)
    }
  })
})

describe('readItem', () => {
  const input = { description: ' Ligne ', quantity: '1,5', unit_price: '10', tva_rate: '7,5' }

  it('reads a complete line with the money module', () => {
    expect(readItem(input)).toEqual({ ok: true, values: { description: 'Ligne', quantity: 1500, unitPrice: 10000, tvaRate: 7500 } })
    expect(readItem({ ...input, quantity: '0,001', unit_price: '0', tva_rate: '0' })).toMatchObject({ ok: true, values: { quantity: 1, unitPrice: 0, tvaRate: 0 } })
  })

  it.each([
    [{ description: '   ' }, { description: 'documents.items.validation.descriptionRequired' }],
    [{ description: 'x'.repeat(501) }, { description: 'validation.tooLong' }],
    [{ quantity: '' }, { quantity: 'documents.items.validation.quantityRequired' }],
    [{ quantity: '0' }, { quantity: 'documents.items.validation.quantityPositive' }],
    [{ quantity: '0,000' }, { quantity: 'documents.items.validation.quantityPositive' }],
    [{ quantity: '-1' }, { quantity: 'validation.quantityInvalid' }],
    [{ quantity: '1e3' }, { quantity: 'validation.quantityInvalid' }],
    [{ unit_price: '' }, { unit_price: 'documents.items.validation.unitPriceRequired' }],
    [{ unit_price: '1 500' }, { unit_price: 'validation.amountInvalid' }],
    [{ tva_rate: '' }, { tva_rate: 'documents.items.validation.tvaRateRequired' }],
    [{ tva_rate: '100,001' }, { tva_rate: 'validation.rateInvalid' }],
  ])('refuses %j', (change, errors) => {
    expect(readItem({ ...input, ...change })).toEqual({ ok: false, errors })
  })

  it('accepts a description of exactly 500 characters', () => {
    expect(readItem({ ...input, description: 'x'.repeat(500) }).ok).toBe(true)
  })
})

describe('preview helpers', () => {
  const line = (quantity: number, unitPrice: number, tvaRate: number, id = 'x') => ({
    id, quantity: qtyMilli(quantity), unitPrice: millimes(unitPrice), tvaRate: rateMilli(tvaRate),
  })

  it('applies the timbre to a facture only, and only with an amount', () => {
    const on = { timbreEnabled: true, timbreFiscal: millimes(1000) }
    expect(previewTimbre('facture', on)).toEqual({ state: 'applied', amount: 1000 })
    expect(previewTimbre('devis', on)).toEqual({ state: 'none' })
    expect(previewTimbre('facture', { ...on, timbreEnabled: false })).toEqual({ state: 'none' })
    expect(previewTimbre('facture', { timbreEnabled: true, timbreFiscal: null })).toEqual({ state: 'missing' })
    expect(previewTimbre('devis', { timbreEnabled: true, timbreFiscal: null })).toEqual({ state: 'none' })
  })

  it('gives exactly what computeTotals gives, and null past the maximum', () => {
    const lines = [line(2000, 10000, 19000)]
    expect(previewTotals(lines, { state: 'applied', amount: millimes(1000) })).toMatchObject({ totalHT: 20000, totalTVA: 3800, timbre: 1000, totalTTC: 24800 })
    expect(previewTotals(lines, { state: 'missing' })).toMatchObject({ timbre: null, totalTTC: 23800 })
    expect(previewTotals(lines, { state: 'none' })).toMatchObject({ timbre: null, totalTTC: 23800 })
    expect(previewTotals([line(2000, 999999999999, 0)], { state: 'none' })).toBeNull()
    expect(previewLineTotal(line(2000, 999999999999, 0))).toBeNull()
    expect(previewLineTotal(line(1500, 1, 0))).toBe(2)
  })

  it('counts the pending line: appended when new, in place when editing, ignored when incomplete', () => {
    const saved = [line(1000, 1000, 0, 'a'), line(1000, 2000, 0, 'b')]
    const typed = line(1000, 9000, 0, 'typed')
    expect(previewLines(saved, { state: 'none' })).toEqual(saved)
    expect(previewLines(saved, { state: 'incomplete', replaces: null })).toEqual(saved)
    expect(previewLines(saved, { state: 'incomplete', replaces: 'a' })).toEqual(saved)
    expect(previewLines(saved, { state: 'complete', replaces: null, line: typed })).toEqual([...saved, typed])
    expect(previewLines(saved, { state: 'complete', replaces: 'a', line: typed })).toEqual([typed, saved[1]])
  })
})
