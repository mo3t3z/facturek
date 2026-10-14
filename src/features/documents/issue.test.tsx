import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeTotals, fromDbNumeric, fromDbQuantity, fromDbRate, toDbNumeric } from '../../lib/money/money'
import translations from '../../locales/fr/translation.json'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'
import { readStoredTotals } from './storedTotals'

// Issuing a draft from the screen, and the read-only view of an issued document.
// The real client is replaced by a recorder: no network, and every request is kept.
type Call = { table: string; op: 'select' | 'insert' | 'update' | 'delete'; columns?: string; filters: Record<string, unknown>; ending?: string }
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
    const end = (ending: string) => () => {
      call.ending = ending
      return run()
    }
    const write = (op: Call['op']) => () => {
      call.op = op
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
      order: () => query,
      limit: () => query,
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
const dbError = (code: string) => ({ code, message: 'internal: relation "documents" expected total differs', details: null, hint: null })
const NO_ROW = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }
const user = userEvent.setup({ delay: null })

const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT = '11111111-1111-4111-8111-111111111111'
const LINE_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const LINE_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'

// As PostgREST returns them with ::text. 19 %: base 20.000, TVA 3.800. 7 %: base 5.000, TVA 0.350.
// Total HT 25.000, TVA 4.150, total TTC 29.150; with the timbre of 1.000: net à payer 30.150.
const lineA = { id: LINE_A, position: 0, description: 'Installation', quantity: '2.000', unit_price: '10.000', tva_rate: '19.000' }
const lineB = { id: LINE_B, position: 3, description: 'Câble', quantity: '1.000', unit_price: '5.000', tva_rate: '7.000' }

const draft = {
  id: DOC, type: 'facture', number: null, year: null, status: 'draft', client_id: CLIENT, issue_date: null, due_date: null, notes: null,
  seller_name: null, seller_matricule_fiscal: null, seller_address: null,
  buyer_name: null, buyer_matricule_fiscal: null, buyer_address: null,
  total_ht: null, total_tva: null, total_ttc: null, timbre_fiscal: null, net_a_payer: null, tva_breakdown: null,
}
// An issued facture whose STORED totals are deliberately NOT those of the two lines above
// (which would give 25.000 / 4.150 / 29.150): the view must show what is stored.
const issued = {
  ...draft, status: 'sent', number: 12, year: 2026, issue_date: '2026-01-01', due_date: '2026-01-31',
  notes: 'Paiement à 30 jours.\nMerci <b>beaucoup</b>',
  seller_name: 'Atelier Amel (à l\'émission)', seller_matricule_fiscal: '7654321/B/M/000', seller_address: '3 avenue Habib Bourguiba\n1000 Tunis',
  buyer_name: 'Élan SARL (ancien nom)', buyer_matricule_fiscal: '1234567/A/M/000', buyer_address: '12 rue de Carthage',
  total_ht: '1000.000', total_tva: '190.000', total_ttc: '1190.000', timbre_fiscal: '0.600', net_a_payer: '1190.600',
  tva_breakdown: [{ rate: '19.000', base: '1000.000', tva: '190.000' }],
}

let document: Record<string, unknown>
let lines: Record<string, unknown>[]
let tax: Record<string, unknown> | null
let organization: Record<string, unknown>
let override: (call: Call) => Result | undefined
/** What finalize_document answers; it may also change the stored document, like Postgres does. */
let finalize: (args: unknown) => Result | Promise<Result>
let finalizeCalls: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  api.calls.length = 0
  document = { ...draft }
  lines = [lineA, lineB]
  tax = { organization_id: 'org-1', default_tva_rate: '19.000', timbre_enabled: true, timbre_fiscal: '1.000' }
  organization = { id: 'org-1', name: 'Atelier Amel', matricule_fiscal: '7654321/B/M/000', address: '3 avenue Habib Bourguiba', email: null, phone: null }
  override = () => undefined
  finalizeCalls = []
  finalize = () => {
    document = { ...issued }
    return ok({ ...issued, net_a_payer: 1190.6 })
  }
  api.rpc.mockImplementation((name: string, args: unknown) => {
    if (name !== 'finalize_document') return Promise.resolve(ok('org-1'))
    finalizeCalls.push(args)
    return Promise.resolve(finalize(args))
  })
  api.respond.mockImplementation((call) => {
    const special = override(call)
    if (special) return special
    if (call.table === 'organizations') return ok(organization)
    if (call.table === 'clients') return ok([{ id: CLIENT, name: 'Société Élan', matricule_fiscal: null, address: null, email: null, phone: null }])
    if (call.table === 'tax_settings') return ok(tax)
    if (call.table === 'documents') return ok(call.op === 'select' ? document : { id: DOC })
    if (call.op === 'select') return ok(lines)
    return ok({ id: call.filters.id ?? 'new-line' })
  })
})

const open = () => renderRoutes(routes, `/app/documents/${DOC}`, authState({ session: fakeSession() }))
const panel = () => screen.findByRole('region', { name: 'Émission' })
const issueButton = (region: HTMLElement, name = 'Émettre la facture') => within(region).getByRole('button', { name })
const confirmation = (region: HTMLElement, name = 'Émettre cette facture ?') => within(region).getByRole('group', { name })
const total = (region: HTMLElement, label: string) => within(region).getByText(label, { selector: 'dt' }).nextElementSibling
const rowLabels = (region: HTMLElement) => within(region).getAllByText(/./, { selector: 'dl.grid > dt' }).map((dt) => dt.textContent)
const selects = (table: string) => api.calls.filter((call) => call.table === table && call.op === 'select')
const french = (code: string) => (translations.errors.db as Record<string, string>)[code]

/** Opens the page and the confirmation of a draft that can be issued. */
async function openConfirmation() {
  open()
  const region = await panel()
  await waitFor(() => expect(issueButton(region)).toBeEnabled())
  await user.click(issueButton(region))
  return { region, group: confirmation(region) }
}

describe('the "Émettre" button of a draft', () => {
  it('is enabled, with no reason shown, when the saved draft has a client, lines and readable tax settings', async () => {
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    expect(within(region).queryByText('Ce document ne peut pas encore être émis :')).not.toBeInTheDocument()
    // Nothing is sent by showing the page.
    expect(finalizeCalls).toEqual([])
  })

  it('is named after the type of the document', async () => {
    document = { ...draft, type: 'devis' }
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region, 'Émettre le devis')).toBeEnabled())
  })

  it.each([
    ['no client is saved on the document', () => { document = { ...draft, client_id: null } }, "Aucun client n'est enregistré sur ce document."],
    ['the document has no saved line', () => { lines = [] }, "Le document n'a aucune ligne enregistrée."],
    ['the tax settings could not be loaded', () => { override = (call) => (call.table === 'tax_settings' ? failed(dbError('42501')) : undefined) },
      "Les paramètres de taxes n'ont pas pu être chargés."],
    ['the timbre is enabled without an amount', () => { tax = { ...tax, timbre_fiscal: null } },
      "Le timbre fiscal est activé mais son montant n'est pas renseigné dans les paramètres."],
    ['the total of the saved lines is zero', () => { lines = [{ ...lineA, unit_price: '0.000' }] }, 'Le total du document est nul.'],
    ['the amounts exceed the largest possible value', () => { lines = [{ ...lineA, unit_price: '999999999.999' }] },
      'Les montants dépassent la valeur maximale possible.'],
  ])('is disabled, with the reason written next to it, when %s', async (_name, arrange, reason) => {
    arrange()
    open()
    const region = await panel()
    const reasons = await within(region).findByRole('status')
    expect(reasons).toHaveTextContent('Ce document ne peut pas encore être émis :')
    expect(reasons).toHaveTextContent(reason)
    const button = issueButton(region)
    expect(button).toBeDisabled()
    // The reason is tied to the button for assistive technologies.
    expect(button).toHaveAttribute('aria-describedby', reasons.id)
    expect(finalizeCalls).toEqual([])
  })

  it('does not block a devis because of the timbre: a devis never carries one', async () => {
    document = { ...draft, type: 'devis' }
    tax = { ...tax, timbre_fiscal: null }
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region, 'Émettre le devis')).toBeEnabled())
  })

  it('is disabled while a new line is being typed, and enabled again once the form is emptied', async () => {
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    const form = screen.getByRole('form', { name: 'Ajouter une ligne' })
    await user.type(within(form).getByLabelText('Désignation'), 'En cours')
    expect(issueButton(region)).toBeDisabled()
    expect(within(region).getByRole('status')).toHaveTextContent('Une ligne est en cours de saisie : enregistrez-la ou videz le formulaire.')
    await user.clear(within(form).getByLabelText('Désignation'))
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
  })

  it('is disabled while a saved line is open for editing', async () => {
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /^Modifier la ligne 1 :/ }))
    expect(issueButton(region)).toBeDisabled()
    expect(within(region).getByRole('status')).toHaveTextContent('Une ligne est en cours de saisie')
  })

  it('is disabled while the header has unsaved changes, and enabled again once the draft is saved', async () => {
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    await user.type(screen.getByLabelText('Notes'), 'Nouvelle note')
    expect(issueButton(region)).toBeDisabled()
    expect(within(region).getByRole('status')).toHaveTextContent("L'en-tête contient des modifications non enregistrées : enregistrez le brouillon.")
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))
    await screen.findByText('Brouillon enregistré.')
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
  })

  it('never sends anything by itself: a click only opens the confirmation', async () => {
    await openConfirmation()
    expect(finalizeCalls).toEqual([])
  })
})

describe('the confirmation', () => {
  it('says plainly what issuing does, and puts the keyboard on "Annuler"', async () => {
    const { region, group } = await openConfirmation()
    expect(group).toHaveTextContent('Une fois émis, le document reçoit son numéro définitif. Il ne pourra plus être modifié ni supprimé.')
    expect(within(group).getByRole('button', { name: 'Annuler' })).toHaveFocus()
    expect(within(group).getByRole('button', { name: "Confirmer l'émission" })).toBeEnabled()
    // The first button is replaced by the question: one decision at a time.
    expect(within(region).queryByRole('button', { name: 'Émettre la facture' })).not.toBeInTheDocument()
  })

  it('shows the five totals of the saved lines, in order', async () => {
    const { group } = await openConfirmation()
    expect(group).toHaveTextContent('Totaux des lignes enregistrées')
    expect(rowLabels(group)).toEqual(['Total HT', 'TVA', 'Total TTC', 'Droit de timbre', 'Net à payer'])
    expect(total(group, 'Total HT')).toHaveTextContent('25,000 TND')
    expect(total(group, 'TVA')).toHaveTextContent('4,150 TND')
    expect(total(group, 'Total TTC')).toHaveTextContent('29,150 TND')
    expect(total(group, 'Droit de timbre')).toHaveTextContent('1,000 TND')
    expect(total(group, 'Net à payer')).toHaveTextContent('30,150 TND')
    expect(within(group).getAllByRole('row').map((row) => row.textContent)).toEqual(['TauxBase HTTVA', '7 %5,000 TND0,350 TND', '19 %20,000 TND3,800 TND'])
  })

  it('shows no timbre row for a devis', async () => {
    document = { ...draft, type: 'devis' }
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region, 'Émettre le devis')).toBeEnabled())
    await user.click(issueButton(region, 'Émettre le devis'))
    const group = confirmation(region, 'Émettre ce devis ?')
    expect(rowLabels(group)).toEqual(['Total HT', 'TVA', 'Total TTC', 'Net à payer'])
    expect(total(group, 'Net à payer')).toHaveTextContent('29,150 TND')
  })

  it('cancelling closes it and sends nothing', async () => {
    const { region, group } = await openConfirmation()
    await user.click(within(group).getByRole('button', { name: 'Annuler' }))
    expect(within(region).queryByRole('group')).not.toBeInTheDocument()
    expect(issueButton(region)).toBeEnabled()
    expect(finalizeCalls).toEqual([])
  })

  it('warns, without blocking, when the seller has no matricule fiscal or no address, with a link to the settings', async () => {
    organization = { ...organization, matricule_fiscal: null, address: '' }
    const { group } = await openConfirmation()
    const note = await within(group).findByRole('note')
    expect(note).toHaveTextContent("Le matricule fiscal de votre entreprise n'est pas renseigné : il ne figurera pas sur ce document.")
    expect(note).toHaveTextContent("L'adresse de votre entreprise n'est pas renseignée : elle ne figurera pas sur ce document.")
    expect(note).toHaveTextContent('Vérifiez avec votre comptable si ces mentions sont obligatoires.')
    expect(within(note).getByRole('link', { name: 'Compléter dans les paramètres' })).toHaveAttribute('href', '/app/settings')
    expect(within(group).getByRole('button', { name: "Confirmer l'émission" })).toBeEnabled()
  })

  it('shows no warning when the seller identity is complete', async () => {
    const { group } = await openConfirmation()
    await waitFor(() => expect(selects('organizations').length).toBeGreaterThan(1))
    expect(within(group).queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('confirming', () => {
  it('sends the document id and, as a STRING, the net à payer computed from the saved lines and the tax settings', async () => {
    const { group } = await openConfirmation()
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    await waitFor(() => expect(finalizeCalls).toHaveLength(1))
    // Built here from the same stored lines, by the same module, independently of the screen.
    const expected = toDbNumeric(
      computeTotals({
        lines: [lineA, lineB].map((line) => ({ quantity: fromDbQuantity(line.quantity), unitPrice: fromDbNumeric(line.unit_price), tvaRate: fromDbRate(line.tva_rate) })),
        timbre: fromDbNumeric('1.000'),
      }).netAPayer,
    )
    expect(expected).toBe('30.150')
    expect(finalizeCalls[0]).toEqual({ p_document_id: DOC, p_expected_net_a_payer: '30.150' })
    expect(Object.keys(finalizeCalls[0] as object)).toEqual(['p_document_id', 'p_expected_net_a_payer'])
    expect(typeof (finalizeCalls[0] as { p_expected_net_a_payer: unknown }).p_expected_net_a_payer).toBe('string')
    // The organization of the screen was checked first.
    const check = selects('documents').find((call) => call.ending === 'single')
    expect(check?.filters).toEqual({ organization_id: 'org-1', id: DOC })
  })

  it('never takes the expected total from a line still being typed', async () => {
    open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    const form = screen.getByRole('form', { name: 'Ajouter une ligne' })
    await user.type(within(form).getByLabelText('Désignation'), 'En cours')
    await user.type(within(form).getByLabelText('Quantité'), '2')
    await user.type(within(form).getByLabelText('Prix unitaire HT (TND)'), '50')
    // The preview counts the line being typed (149,150)...
    const preview = screen.getByRole('region', { name: /^Totaux/ })
    await waitFor(() => expect(total(preview, 'Net à payer')).toHaveTextContent('149,150 TND'))
    // ...and for that very reason the document cannot be issued in this state.
    expect(issueButton(region)).toBeDisabled()
    // Once the form is emptied, what would be sent is the total of the SAVED lines.
    for (const label of ['Désignation', 'Quantité', 'Prix unitaire HT (TND)']) await user.clear(within(form).getByLabelText(label))
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    await user.click(issueButton(region))
    expect(total(confirmation(region), 'Net à payer')).toHaveTextContent('30,150 TND')
    await user.click(within(confirmation(region)).getByRole('button', { name: "Confirmer l'émission" }))
    await waitFor(() => expect(finalizeCalls).toEqual([{ p_document_id: DOC, p_expected_net_a_payer: '30.150' }]))
  })

  it('sends ONE request for a double click, and disables both buttons while it is pending', async () => {
    let answer: (result: Result) => void = () => undefined
    finalize = () => new Promise<Result>((resolve) => { answer = resolve })
    const { group } = await openConfirmation()
    await user.dblClick(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    const pending = await within(group).findByRole('button', { name: 'Émission…' })
    expect(pending).toBeDisabled()
    expect(within(group).getByRole('button', { name: 'Annuler' })).toBeDisabled()
    await user.click(pending)
    expect(finalizeCalls).toHaveLength(1)
    document = { ...issued }
    answer(ok({ ...issued }))
    await screen.findByRole('heading', { level: 1, name: 'Facture 2026-0012' })
    expect(finalizeCalls).toHaveLength(1)
  })

  it('after success, reloads the document and its lines and shows the issued view of the same page', async () => {
    const { router } = open()
    const region = await panel()
    await waitFor(() => expect(issueButton(region)).toBeEnabled())
    const before = { documents: selects('documents').length, items: selects('document_items').length }
    await user.click(issueButton(region))
    await user.click(within(confirmation(region)).getByRole('button', { name: "Confirmer l'émission" }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Facture 2026-0012' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/app/documents/${DOC}`)
    // The detail and the lines were asked again (the list is under the same query key).
    expect(selects('documents').length).toBeGreaterThan(before.documents + 1)
    expect(selects('document_items').length).toBeGreaterThan(before.items)
    // No form, no issue panel any more.
    expect(screen.queryByRole('region', { name: 'Émission' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Émettre|Enregistrer|Modifier|Supprimer|Ajouter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('refusals of finalize_document', () => {
  it('DF009: says the totals changed, closes the confirmation, and reloads the lines and the tax settings', async () => {
    finalize = () => {
      // Meanwhile, elsewhere: a line was removed and the timbre changed.
      lines = [lineA]
      tax = { ...tax, timbre_fiscal: '0.600' }
      return failed(dbError('DF009'))
    }
    const { region, group } = await openConfirmation()
    const before = { items: selects('document_items').length, tax: selects('tax_settings').length }
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))

    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent(
      "Rien n'a été émis : les totaux de ce document ont changé depuis leur affichage. Les lignes et les paramètres viennent d'être rechargés : vérifiez le nouveau total, puis émettez à nouveau.",
    )
    expect(alert).not.toHaveTextContent(/internal|relation|expected total/)
    expect(within(region).queryByRole('group')).not.toBeInTheDocument()
    expect(selects('document_items').length).toBeGreaterThan(before.items)
    expect(selects('tax_settings').length).toBeGreaterThan(before.tax)
    // The screen now shows the real total, and the next confirmation would send that one.
    const preview = screen.getByRole('region', { name: /^Totaux/ })
    await waitFor(() => expect(total(preview, 'Net à payer')).toHaveTextContent('24,400 TND'))
    finalize = () => failed(dbError('DF009'))
    await user.click(issueButton(region))
    // Opening the confirmation again clears the old message.
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(confirmation(region)).getByRole('button', { name: "Confirmer l'émission" }))
    await waitFor(() => expect(finalizeCalls).toHaveLength(2))
    expect(finalizeCalls[1]).toEqual({ p_document_id: DOC, p_expected_net_a_payer: '24.400' })
    // Still a draft.
    expect(screen.getByRole('heading', { level: 1, name: 'Facture en brouillon' })).toBeInTheDocument()
  })

  it('DF002 (already issued elsewhere): reloads the document and shows its issued view', async () => {
    finalize = () => {
      document = { ...issued }
      return failed(dbError('DF002'))
    }
    const { group } = await openConfirmation()
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Facture 2026-0012' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Émission' })).not.toBeInTheDocument()
    expect(screen.queryByText(/internal|relation/)).not.toBeInTheDocument()
  })

  it('DF002 while the document still reads as a draft: says it was already issued', async () => {
    finalize = () => failed(dbError('DF002'))
    const { region, group } = await openConfirmation()
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    expect(await within(region).findByRole('alert')).toHaveTextContent("Ce document a déjà été émis. Son état vient d'être rechargé.")
  })

  it.each(['DF003', 'DF004', 'DF005', 'DF006', 'DF007', 'DF008', 'DF022', 'DF023'])(
    '%s: shows its French message, never the raw one, and issues nothing',
    async (code) => {
      finalize = () => failed(dbError(code))
      const { region, group } = await openConfirmation()
      await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
      const alert = await within(region).findByRole('alert')
      expect(french(code)).toBeTruthy()
      expect(alert).toHaveTextContent(french(code) as string)
      expect(alert).not.toHaveTextContent(/internal|relation|expected total/)
      expect(within(region).queryByRole('group')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1, name: 'Facture en brouillon' })).toBeInTheDocument()
    },
  )

  it.each(['DF001', 'PGRST116'])('%s from the function: says the document cannot be found', async (code) => {
    finalize = () => failed(dbError(code))
    const { region, group } = await openConfirmation()
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    expect(await within(region).findByRole('alert')).toHaveTextContent('Ce document est introuvable. Il a peut-être été supprimé.')
  })

  it('a document that is not in the organization of the screen: nothing is sent to the function', async () => {
    const { region, group } = await openConfirmation()
    override = (call) => (call.table === 'documents' && call.ending === 'single' ? failed(NO_ROW) : undefined)
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    expect(await within(region).findByRole('alert')).toHaveTextContent('Ce document est introuvable. Il a peut-être été supprimé.')
    expect(finalizeCalls).toEqual([])
  })

  it('an unknown error: the generic French message, never the raw one', async () => {
    finalize = () => failed(dbError('XX999'))
    const { region, group } = await openConfirmation()
    await user.click(within(group).getByRole('button', { name: "Confirmer l'émission" }))
    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent(translations.errors.unknown)
    expect(alert).not.toHaveTextContent(/internal|relation|XX999/)
  })
})

describe('the issued view', () => {
  beforeEach(() => {
    document = { ...issued }
  })
  const totals = () => screen.findByRole('region', { name: 'Totaux' })

  it('shows the number, the type, the French status and the dates as they are stored', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 1, name: 'Facture 2026-0012' })).toBeInTheDocument()
    expect(screen.getByText('Ce document a été émis : il ne peut plus être modifié.')).toBeInTheDocument()
    expect(screen.getByText('Numéro').nextElementSibling).toHaveTextContent('2026-0012')
    expect(screen.getByText('Type').nextElementSibling).toHaveTextContent('Facture')
    expect(screen.getByText('Statut').nextElementSibling).toHaveTextContent('Émise')
    // Plain calendar days: the first of January stays the first of January.
    expect(screen.getByText("Date d'émission").nextElementSibling).toHaveTextContent('01/01/2026')
    expect(screen.getByText('Échéance').nextElementSibling).toHaveTextContent('31/01/2026')
  })

  it('shows the seller and the buyer from the snapshot columns, not from today\'s organization or client', async () => {
    organization = { ...organization, name: 'Nouveau nom', matricule_fiscal: 'AUTRE', address: 'Ailleurs' }
    open()
    const seller = within(await screen.findByRole('region', { name: 'Vendeur' }))
    expect(seller.getByText('Nom').nextElementSibling).toHaveTextContent("Atelier Amel (à l'émission)")
    expect(seller.getByText('Matricule fiscal').nextElementSibling).toHaveTextContent('7654321/B/M/000')
    expect(seller.getByText('Adresse').nextElementSibling).toHaveTextContent('3 avenue Habib Bourguiba 1000 Tunis')
    const buyer = within(screen.getByRole('region', { name: 'Client' }))
    expect(buyer.getByText('Nom').nextElementSibling).toHaveTextContent('Élan SARL (ancien nom)')
    expect(buyer.getByText('Matricule fiscal').nextElementSibling).toHaveTextContent('1234567/A/M/000')
    expect(buyer.getByText('Adresse').nextElementSibling).toHaveTextContent('12 rue de Carthage')
    // The clients are not loaded, and the organization details are not read for this view.
    expect(selects('clients')).toEqual([])
    expect(screen.queryByText(/Nouveau nom|AUTRE|Ailleurs/)).not.toBeInTheDocument()
  })

  it('shows a dash for a snapshot field that is empty', async () => {
    document = { ...issued, seller_matricule_fiscal: null, seller_address: null }
    open()
    const seller = within(await screen.findByRole('region', { name: 'Vendeur' }))
    expect(seller.getByText('Matricule fiscal').nextElementSibling).toHaveTextContent(/^—$/)
    expect(seller.getByText('Adresse').nextElementSibling).toHaveTextContent(/^—$/)
  })

  it('shows the STORED totals, which here differ from what the lines would give', async () => {
    open()
    const region = await totals()
    expect(rowLabels(region)).toEqual(['Total HT', 'TVA', 'Total TTC', 'Droit de timbre', 'Net à payer'])
    expect(total(region, 'Total HT')).toHaveTextContent(/^1\s000,000 TND$/)
    expect(total(region, 'TVA')).toHaveTextContent(/^190,000 TND$/)
    expect(total(region, 'Total TTC')).toHaveTextContent(/^1\s190,000 TND$/)
    expect(total(region, 'Droit de timbre')).toHaveTextContent(/^0,600 TND$/)
    expect(total(region, 'Net à payer')).toHaveTextContent(/^1\s190,600 TND$/)
    // The table by rate is the stored breakdown: one rate, although the lines have two.
    expect(within(region).getAllByRole('row').map((row) => row.textContent?.replace(/\s/g, ' '))).toEqual(['TauxBase HTTVA', '19 %1 000,000 TND190,000 TND'])
    // What the two lines would give (25.000 / 4.150 / 29.150 / 30.150) appears nowhere in the totals.
    await screen.findByText('Installation')
    expect(region).not.toHaveTextContent(/25,000|4,150|29,150|30,150|0,350/)
  })

  it('says that the net à payer is before any retenue à la source', async () => {
    open()
    expect(within(await totals()).getByRole('note')).toHaveTextContent("Le net à payer s'entend avant toute retenue à la source. À vérifier avec votre comptable.")
  })

  it('shows no timbre row when none was charged', async () => {
    document = { ...issued, timbre_fiscal: null, net_a_payer: '1190.000' }
    open()
    const region = await totals()
    expect(rowLabels(region)).toEqual(['Total HT', 'TVA', 'Total TTC', 'Net à payer'])
    expect(total(region, 'Net à payer')).toHaveTextContent(/^1\s190,000 TND$/)
  })

  it('shows the lines read-only and the notes as plain text', async () => {
    open()
    expect(await screen.findByText('Installation')).toBeInTheDocument()
    expect(screen.getByText('2 lignes')).toBeInTheDocument()
    const notes = within(screen.getByRole('region', { name: 'Notes' }))
    // Text, not HTML: the tag is shown as typed and creates no element.
    expect(notes.getByText(/Paiement à 30 jours\.\s+Merci <b>beaucoup<\/b>/)).toBeInTheDocument()
    expect(window.document.querySelector('b')).toBeNull()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).toHaveTextContent(/Déconnexion|déconnecter/i)
  })

  it('has no notes block when there is no note', async () => {
    document = { ...issued, notes: null }
    open()
    await totals()
    expect(screen.queryByRole('region', { name: 'Notes' })).not.toBeInTheDocument()
  })

  it('offers nothing to issue, edit, delete, print or download, and reads no tax settings', async () => {
    open()
    await totals()
    expect(screen.queryByRole('region', { name: 'Émission' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Émettre|Modifier|Supprimer|Enregistrer|Imprimer|PDF|Télécharger|Paiement/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Imprimer|PDF|Télécharger/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Aperçu, non enregistré')).not.toBeInTheDocument()
    // Nothing is computed from today's settings: they are not even read.
    expect(selects('tax_settings')).toEqual([])
    expect(finalizeCalls).toEqual([])
  })

  it('selects every amount as text', async () => {
    open()
    await totals()
    const columns = selects('documents').find((call) => call.ending === 'maybeSingle')?.columns ?? ''
    for (const column of ['total_ht', 'total_tva', 'total_ttc', 'timbre_fiscal', 'net_a_payer']) expect(columns).toContain(`${column}::text`)
    expect(columns).toContain('tva_breakdown')
    expect(columns).not.toMatch(/\*/)
  })

  it.each([
    ['a breakdown value is a JSON number', { tva_breakdown: [{ rate: '19.000', base: 1000, tva: '190.000' }] }],
    ['a breakdown rate is a JSON number', { tva_breakdown: [{ rate: 19, base: '1000.000', tva: '190.000' }] }],
    ['a breakdown entry misses a key', { tva_breakdown: [{ rate: '19.000', base: '1000.000' }] }],
    ['a breakdown entry has an extra key', { tva_breakdown: [{ rate: '19.000', base: '1000.000', tva: '190.000', total: '1190.000' }] }],
    ['a breakdown amount does not have 3 decimals', { tva_breakdown: [{ rate: '19.000', base: '1000.0', tva: '190.000' }] }],
    ['a breakdown entry is not an object', { tva_breakdown: ['19.000'] }],
    ['the breakdown is an object, not an array', { tva_breakdown: { rate: '19.000', base: '1000.000', tva: '190.000' } }],
    ['the breakdown is missing', { tva_breakdown: null }],
    ['a total is missing', { total_ttc: null }],
    ['a total does not have 3 decimals', { net_a_payer: '1190.6' }],
    ['a total is not a number', { total_ht: 'abc' }],
  ])('shows an error and NO amount when %s', async (_name, broken) => {
    document = { ...issued, ...broken }
    open()
    const region = await totals()
    expect(within(region).getByRole('alert')).toHaveTextContent("Les totaux enregistrés sur ce document sont illisibles : aucun montant n'est affiché. Contactez le support.")
    // Not a guess, not a partial table, and certainly not the totals of the lines.
    expect(region).not.toHaveTextContent(/TND/)
    expect(within(region).queryByRole('table')).not.toBeInTheDocument()
    expect(within(region).queryByText('Net à payer')).not.toBeInTheDocument()
    // The rest of the document is still shown.
    expect(screen.getByRole('heading', { level: 1, name: 'Facture 2026-0012' })).toBeInTheDocument()
    expect(await screen.findByText('Installation')).toBeInTheDocument()
  })
})

describe('readStoredTotals', () => {
  const columns = {
    total_ht: '1000.000', total_tva: '190.000', total_ttc: '1190.000', timbre_fiscal: '0.600', net_a_payer: '1190.600',
    tva_breakdown: [{ rate: '19.000', base: '1000.000', tva: '190.000' }, { rate: '0.000', base: '0.000', tva: '0.000' }] as unknown,
  }

  it('reads the stored columns into integers of millimes, keeping the order of the breakdown', () => {
    expect(readStoredTotals(columns)).toEqual({
      tvaLines: [{ rate: 19000, baseHT: 1000000, tva: 190000 }, { rate: 0, baseHT: 0, tva: 0 }],
      totalHT: 1000000, totalTVA: 190000, totalTTC: 1190000, timbre: 600, netAPayer: 1190600,
    })
  })

  it('reads a document without a timbre, and an empty breakdown', () => {
    expect(readStoredTotals({ ...columns, timbre_fiscal: null, tva_breakdown: [] })).toMatchObject({ timbre: null, tvaLines: [] })
  })

  it('does not check the arithmetic: it reports what is stored, even if it does not add up', () => {
    expect(readStoredTotals({ ...columns, net_a_payer: '5.000' })).toMatchObject({ totalTTC: 1190000, netAPayer: 5000 })
  })

  it('returns null for a draft: a draft stores no total', () => {
    expect(readStoredTotals({ total_ht: null, total_tva: null, total_ttc: null, timbre_fiscal: null, net_a_payer: null, tva_breakdown: null })).toBeNull()
  })

  it.each([
    [{ total_ht: '1000' }],
    [{ total_tva: '190,000' }],
    [{ total_ttc: ' 1190.000' }],
    [{ net_a_payer: '-1.000' }],
    [{ timbre_fiscal: '0.6' }],
    [{ net_a_payer: '9999999999.999' }],
    [{ tva_breakdown: [{ rate: '119.000', base: '1.000', tva: '1.000' }] }],
    [{ tva_breakdown: [null] }],
    [{ tva_breakdown: [[]] }],
    [{ tva_breakdown: '[]' }],
  ])('returns null, never a partial result, for %j', (broken) => {
    expect(readStoredTotals({ ...columns, ...broken })).toBeNull()
  })
})
