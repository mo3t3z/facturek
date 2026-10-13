import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'

// The real client is replaced by a recorder: no network, and every query the screen
// builds is kept (table, operation, columns, payload, filters) so the tests can check it.
type Call = {
  table: string
  op: 'select' | 'update'
  columns?: string
  payload?: Record<string, unknown>
  filters: Record<string, unknown>
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
    const end = (ending: 'single' | 'maybeSingle') => () => {
      call.ending = ending
      return Promise.resolve(api.respond(call))
    }
    const query = {
      select: (columns: string) => {
        call.columns = columns
        return query
      },
      update: (payload: Record<string, unknown>) => {
        call.op = 'update'
        call.payload = payload
        return query
      },
      eq: (column: string, value: unknown) => {
        call.filters[column] = value
        return query
      },
      single: end('single'),
      maybeSingle: end('maybeSingle'),
    }
    return query
  }
  return { supabase: { from, rpc: api.rpc, auth: { signOut: api.signOut } } }
})

import { routes } from '../../app/router'

const ok = (data: unknown): Result => ({ data, error: null })
const failed = (error: object): Result => ({ data: null, error })
// What PostgREST answers to .single() when the UPDATE matched no row (RLS filtered it out).
const NO_ROW = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' }
const user = userEvent.setup({ delay: null })

let organization: Record<string, unknown>
let tax: Record<string, unknown> | null
let override: (call: Call) => Result | undefined

beforeEach(() => {
  vi.clearAllMocks()
  api.calls.length = 0
  organization = { id: 'org-1', name: 'Atelier Amel', matricule_fiscal: '1234567/A/M/000', address: null, email: null, phone: '71 123 456' }
  // A new account: nothing is set.
  tax = { organization_id: 'org-1', default_tva_rate: null, timbre_enabled: false, timbre_fiscal: null }
  override = () => undefined
  api.rpc.mockResolvedValue(ok('org-1'))
  api.respond.mockImplementation((call) => {
    const special = override(call)
    if (special) return special
    if (call.op === 'update') return ok({ id: 'org-1' })
    return ok(call.table === 'organizations' ? organization : tax)
  })
})

function open() {
  return renderRoutes(routes, '/app/settings', authState({ session: fakeSession() }))
}
const updates = (table: string) => api.calls.filter((call) => call.table === table && call.op === 'update')
const selects = (table: string) => api.calls.filter((call) => call.table === table && call.op === 'select' && call.columns !== 'id, name')
const identity = () => screen.findByRole('button', { name: "Enregistrer l'entreprise" })
const taxes = () => screen.findByRole('button', { name: 'Enregistrer les taxes' })
const rate = () => screen.getByLabelText('Taux de TVA par défaut (%)')
const timbre = () => screen.getByLabelText('Montant du timbre fiscal (TND)')
const timbreSwitch = () => screen.getByRole('checkbox', { name: 'Appliquer le timbre fiscal sur les factures' })

describe('settings page', () => {
  it('is reachable from the navigation and shows the two sections', async () => {
    const { router } = renderRoutes(routes, '/app', authState({ session: fakeSession() }))
    await user.click(screen.getByRole('link', { name: 'Paramètres' }))
    expect(router.state.location.pathname).toBe('/app/settings')
    expect(await screen.findByRole('heading', { level: 1, name: 'Paramètres' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Votre entreprise' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Taxes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Paramètres' })).toHaveAttribute('aria-current', 'page')
  })

  it('reads the numeric columns as text and never reads the retenue columns', async () => {
    open()
    await taxes()
    const [read] = selects('tax_settings')
    expect(read?.columns).toBe('organization_id, default_tva_rate::text, timbre_enabled, timbre_fiscal::text')
    expect(read?.filters).toEqual({ organization_id: 'org-1' })
    expect(selects('organizations').at(-1)?.filters).toEqual({ id: 'org-1' })
  })

  it('shows the accountant notice, and no retenue field at all', async () => {
    tax = { ...tax, retenue_enabled: true, retenue_rate: '1.000', retenue_threshold: '1000.000' }
    open()
    await taxes()
    expect(screen.getByRole('note')).toHaveTextContent(/doivent être vérifiés auprès de votre comptable/)
    expect(screen.queryByText(/retenue/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/retenue|seuil/i)).not.toBeInTheDocument()
    // Exactly the three tax controls: rate, switch, amount.
    const form = (await taxes()).closest('form') as HTMLFormElement
    expect(within(form).getAllByRole('textbox')).toHaveLength(2)
    expect(within(form).getAllByRole('checkbox')).toHaveLength(1)
  })

  it('offers no default value: a new account has empty fields and an unchecked switch', async () => {
    open()
    await taxes()
    expect(rate()).toHaveValue('')
    expect(timbre()).toHaveValue('')
    expect(timbreSwitch()).not.toBeChecked()
    expect(rate()).not.toHaveAttribute('placeholder')
    expect(timbre()).not.toHaveAttribute('placeholder')
  })
})

describe('organization identity', () => {
  it('shows the stored values and saves empty optional fields as NULL', async () => {
    open()
    await identity()
    const name = screen.getByLabelText('Nom ou raison sociale')
    expect(name).toHaveValue('Atelier Amel')
    expect(screen.getByLabelText('Matricule fiscal')).toHaveValue('1234567/A/M/000')
    await user.clear(name)
    await user.type(name, '  Atelier Amel SARL ')
    await user.clear(screen.getByLabelText('Matricule fiscal'))
    await user.clear(screen.getByLabelText('Téléphone'))
    await user.type(screen.getByLabelText('Adresse'), '12 rue de Carthage')
    await user.click(await identity())

    expect(await screen.findByText('Modifications enregistrées.')).toBeInTheDocument()
    expect(updates('organizations')).toEqual([
      {
        table: 'organizations',
        op: 'update',
        payload: { name: 'Atelier Amel SARL', matricule_fiscal: null, address: '12 rue de Carthage', email: null, phone: null },
        filters: { id: 'org-1' },
        columns: 'id',
        ending: 'single',
      },
    ])
  })

  it('requires a name and a valid e-mail, in French, without calling the database', async () => {
    open()
    await identity()
    await user.clear(screen.getByLabelText('Nom ou raison sociale'))
    await user.type(screen.getByLabelText('Adresse e-mail'), 'pas-un-email')
    await user.click(await identity())
    expect(screen.getByLabelText('Nom ou raison sociale')).toHaveAccessibleDescription('Ce champ est obligatoire.')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(/Adresse e-mail invalide\./)
    expect(updates('organizations')).toEqual([])
  })

  it('says that nothing was saved when the update matched no row', async () => {
    override = (call) => (call.table === 'organizations' && call.op === 'update' ? failed(NO_ROW) : undefined)
    open()
    await user.click(await identity())
    expect(await screen.findByRole('alert')).toHaveTextContent("Rien n'a été enregistré : vous n'avez pas les droits nécessaires")
    expect(screen.queryByText('Modifications enregistrées.')).not.toBeInTheDocument()
    expect(screen.queryByText(/JSON object|0 rows/)).not.toBeInTheDocument()
  })
})

describe('tax settings', () => {
  it('saves empty fields as NULL, never as zero', async () => {
    tax = { organization_id: 'org-1', default_tva_rate: '19.000', timbre_enabled: false, timbre_fiscal: '1.000' }
    open()
    await taxes()
    expect(rate()).toHaveValue('19')
    expect(timbre()).toHaveValue('1,000')
    await user.clear(rate())
    await user.clear(timbre())
    await user.click(await taxes())

    expect(await screen.findByText('Modifications enregistrées.')).toBeInTheDocument()
    expect(updates('tax_settings')).toEqual([
      {
        table: 'tax_settings',
        op: 'update',
        payload: { default_tva_rate: null, timbre_enabled: false, timbre_fiscal: null },
        filters: { organization_id: 'org-1' },
        columns: 'organization_id',
        ending: 'single',
      },
    ])
  })

  it('sends the rate and the amount as strings with 3 decimals, and never a retenue column', async () => {
    open()
    await taxes()
    await user.type(rate(), '7,5')
    await user.click(timbreSwitch())
    await user.type(timbre(), '1')
    await user.click(await taxes())

    await screen.findByText('Modifications enregistrées.')
    const payload = updates('tax_settings')[0]?.payload
    expect(payload).toStrictEqual({ default_tva_rate: '7.500', timbre_enabled: true, timbre_fiscal: '1.000' })
    expect(typeof payload?.default_tva_rate).toBe('string')
    expect(typeof payload?.timbre_fiscal).toBe('string')
  })

  it('requires the amount when the timbre is applied, and not otherwise', async () => {
    open()
    await taxes()
    await user.click(timbreSwitch())
    await user.click(await taxes())
    expect(timbre()).toBeInvalid()
    expect(timbre()).toHaveAccessibleDescription(/Indiquez le montant du timbre fiscal, ou décochez la case\./)
    expect(updates('tax_settings')).toEqual([])

    await user.click(timbreSwitch())
    await user.click(await taxes())
    await screen.findByText('Modifications enregistrées.')
    expect(updates('tax_settings')[0]?.payload).toEqual({ default_tva_rate: null, timbre_enabled: false, timbre_fiscal: null })
  })

  it('accepts a timbre amount of spaces only as empty, so it is still required', async () => {
    open()
    await taxes()
    await user.click(timbreSwitch())
    await user.type(timbre(), '   ')
    await user.click(await taxes())
    expect(timbre()).toHaveAccessibleDescription(/Indiquez le montant du timbre fiscal/)
    expect(updates('tax_settings')).toEqual([])
  })

  it('refuses a value it cannot read, in French, without calling the database', async () => {
    open()
    await taxes()
    await user.type(rate(), '101')
    await user.type(timbre(), '1 500')
    await user.click(await taxes())
    expect(rate()).toBeInvalid()
    expect(rate()).toHaveAccessibleDescription(/Taux invalide\. Saisissez un pourcentage entre 0 et 100/)
    expect(timbre()).toBeInvalid()
    expect(timbre()).toHaveAccessibleDescription(/Montant invalide\./)
    expect(updates('tax_settings')).toEqual([])
  })

  it('says that nothing was saved when the update matched no row', async () => {
    override = (call) => (call.table === 'tax_settings' && call.op === 'update' ? failed(NO_ROW) : undefined)
    open()
    await taxes()
    await user.type(rate(), '19')
    await user.click(await taxes())
    const form = (await taxes()).closest('form') as HTMLFormElement
    expect(await within(form).findByRole('alert')).toHaveTextContent("Rien n'a été enregistré")
    expect(screen.queryByText('Modifications enregistrées.')).not.toBeInTheDocument()
  })

  it('shows a French message for any other failure, never the raw one', async () => {
    override = (call) =>
      call.table === 'tax_settings' && call.op === 'update'
        ? failed({ code: '23514', message: 'new row violates check constraint "tax_settings_default_tva_rate_check"' })
        : undefined
    open()
    await taxes()
    await user.click(await taxes())
    const form = (await taxes()).closest('form') as HTMLFormElement
    expect(await within(form).findByRole('alert')).toHaveTextContent('Certaines valeurs saisies ne sont pas valides.')
    expect(screen.queryByText(/check constraint/)).not.toBeInTheDocument()
  })

  it('shows a load error with a retry instead of an empty form', async () => {
    let fail = true
    override = (call) =>
      call.table === 'tax_settings' && call.op === 'select' && fail ? failed({ code: '42501', message: 'permission denied for table tax_settings' }) : undefined
    open()
    expect(await screen.findByText(/Les paramètres n'ont pas pu être chargés\./)).toBeInTheDocument()
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer les taxes' })).not.toBeInTheDocument()
    // The other section still works.
    expect(await identity()).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await taxes()).toBeInTheDocument()
  })
})

describe('the amount and rate input', () => {
  const NBSP = ' '

  it('shows the value as it was understood once the user leaves the field', async () => {
    open()
    await taxes()
    await user.type(timbre(), '1500')
    // Nothing while typing.
    expect(screen.queryByText(/^= /)).not.toBeInTheDocument()
    await user.tab()
    expect(timbre()).toHaveAccessibleDescription(new RegExp(`= 1${NBSP}500,000 TND$`))
    expect(timbre()).toBeValid()

    await user.type(rate(), '19')
    await user.tab()
    expect(rate()).toHaveAccessibleDescription(/= 19 %$/)
  })

  it('makes it visible that "1.500" and "1,500" are both one and a half', async () => {
    open()
    await taxes()
    await user.type(timbre(), '1.500')
    await user.tab()
    expect(timbre()).toHaveAccessibleDescription(/= 1,500 TND$/)
    await user.clear(timbre())
    await user.type(timbre(), '1,500')
    await user.tab()
    expect(timbre()).toHaveAccessibleDescription(/= 1,500 TND$/)
    await user.clear(rate())
    await user.type(rate(), '7.50')
    await user.tab()
    expect(rate()).toHaveAccessibleDescription(/= 7,5 %$/)
  })

  it('shows a French error, as soon as the field is left, for a text it cannot read', async () => {
    open()
    await taxes()
    await user.type(timbre(), '1 500')
    await user.tab()
    expect(timbre()).toBeInvalid()
    expect(timbre()).toHaveAccessibleDescription(/Montant invalide\. Exemples : 12 ou 12,500/)
    expect(screen.queryByText(/^= /)).not.toBeInTheDocument()

    await user.type(rate(), '12,5000')
    await user.tab()
    expect(rate()).toBeInvalid()
    expect(rate()).toHaveAccessibleDescription(/Taux invalide\./)
  })

  it('shows nothing for an empty field, and shows the stored values when the page opens', async () => {
    tax = { organization_id: 'org-1', default_tva_rate: '19.000', timbre_enabled: true, timbre_fiscal: '1.000' }
    open()
    await taxes()
    expect(rate()).toHaveAccessibleDescription(/= 19 %$/)
    expect(timbre()).toHaveAccessibleDescription(/= 1,000 TND$/)
    expect(timbreSwitch()).toBeChecked()
    await user.clear(rate())
    await user.tab()
    expect(rate()).not.toHaveAccessibleDescription(/=/)
    expect(rate()).toBeValid()
  })

  it('is a text input with a decimal keyboard, not a number input', async () => {
    open()
    await taxes()
    expect(timbre()).toHaveAttribute('type', 'text')
    expect(timbre()).toHaveAttribute('inputmode', 'decimal')
  })

  it('never lets a stored value pass through a float: 3 decimals survive the round trip', async () => {
    tax = { organization_id: 'org-1', default_tva_rate: '7.125', timbre_enabled: true, timbre_fiscal: '999999999.999' }
    open()
    await taxes()
    expect(rate()).toHaveValue('7,125')
    expect(timbre()).toHaveValue('999999999,999')
    await user.click(await taxes())
    await waitFor(() => expect(updates('tax_settings')).toHaveLength(1))
    expect(updates('tax_settings')[0]?.payload).toStrictEqual({
      default_tva_rate: '7.125',
      timbre_enabled: true,
      timbre_fiscal: '999999999.999',
    })
  })
})
