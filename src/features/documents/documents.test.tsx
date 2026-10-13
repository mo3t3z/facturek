import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'

// The real client is replaced by a recorder: no network, and every query the screens
// build is kept (table, operation, columns, payload, filters, order, limit).
type Call = {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  columns?: string
  payload?: Record<string, unknown>
  filters: Record<string, unknown>
  order?: [string, unknown]
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
    const query = {
      select: (columns: string) => {
        call.columns = columns
        return query
      },
      insert: (payload: Record<string, unknown>) => {
        call.op = 'insert'
        call.payload = payload
        return query
      },
      update: (payload: Record<string, unknown>) => {
        call.op = 'update'
        call.payload = payload
        return query
      },
      delete: () => {
        call.op = 'delete'
        return query
      },
      eq: (column: string, value: unknown) => {
        call.filters[column] = value
        return query
      },
      order: (column: string, options: unknown) => {
        call.order = [column, options]
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

const ELAN = '11111111-1111-4111-8111-111111111111'
const BECHIR = '22222222-2222-4222-8222-222222222222'
const DRAFT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const clients = [
  { id: BECHIR, name: 'Béchir Trabelsi', matricule_fiscal: null, address: null, email: null, phone: null },
  { id: ELAN, name: 'Société Élan', matricule_fiscal: null, address: null, email: null, phone: null },
]
const draftRow = {
  id: DRAFT, type: 'devis', number: null, year: null, status: 'draft', issue_date: null, due_date: '2026-11-12',
  buyer_name: null, client: { name: 'Société Élan' },
}
const sentRow = {
  id: SENT, type: 'facture', number: 7, year: 2026, status: 'sent', issue_date: '2026-01-01', due_date: null,
  // The client was renamed after the facture was issued: the snapshot must win.
  buyer_name: 'Élan SARL (ancien nom)', client: { name: 'Société Élan' },
}
const draftDetail = {
  id: DRAFT, type: 'devis', number: null, year: null, status: 'draft', client_id: ELAN, issue_date: null, due_date: '2026-11-12',
  notes: 'À confirmer', buyer_name: null, buyer_matricule_fiscal: null, buyer_address: null,
}
const sentDetail = {
  id: SENT, type: 'facture', number: 7, year: 2026, status: 'sent', client_id: ELAN, issue_date: '2026-01-01', due_date: null,
  notes: null, buyer_name: 'Élan SARL (ancien nom)', buyer_matricule_fiscal: '1234567/A/M/000', buyer_address: '12 rue de Carthage',
}

let list: Record<string, unknown>[]
let storedClients: typeof clients
let details: Record<string, Record<string, unknown>>
let override: (call: Call) => Result | undefined

beforeEach(() => {
  vi.clearAllMocks()
  api.calls.length = 0
  list = [sentRow, draftRow]
  storedClients = clients
  details = { [DRAFT]: draftDetail, [SENT]: sentDetail }
  override = () => undefined
  api.rpc.mockResolvedValue(ok('org-1'))
  api.signOut.mockResolvedValue({ error: null })
  api.respond.mockImplementation((call) => {
    const special = override(call)
    if (special) return special
    if (call.table === 'organizations') return ok({ id: 'org-1', name: 'Atelier Amel' })
    if (call.table === 'clients') return ok(storedClients)
    if (call.op === 'insert') return ok({ id: NEW })
    if (call.op === 'update' || call.op === 'delete') return ok({ id: call.filters.id })
    if ('id' in call.filters) return ok(details[String(call.filters.id)] ?? null)
    return ok(
      list.filter((row) => (call.filters.type === undefined || row.type === call.filters.type) && (call.filters.status === undefined || row.status === call.filters.status)),
    )
  })
})

const open = (path: string) => renderRoutes(routes, path, authState({ session: fakeSession() }))
const documentCalls = (op: Call['op']) => api.calls.filter((call) => call.table === 'documents' && call.op === op)
const listCalls = () => documentCalls('select').filter((call) => !('id' in call.filters))
const location = (router: { state: { location: { pathname: string; search: string } } }) =>
  `${router.state.location.pathname}${router.state.location.search}`
const card = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('li') as HTMLElement

describe('documents list', () => {
  it('is reachable from the navigation', async () => {
    const { router } = open('/app')
    await user.click(screen.getByRole('link', { name: 'Documents' }))
    expect(location(router)).toBe('/app/documents')
    expect(await screen.findByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument()
  })

  it('asks for the documents of the current organization only, newest first, explicit columns, 1000 at most', async () => {
    open('/app/documents')
    await screen.findByText('2 documents')
    expect(listCalls()).toEqual([
      {
        table: 'documents',
        op: 'select',
        columns: 'id, type, number, year, status, issue_date, due_date, buyer_name, client:clients(name)',
        filters: { organization_id: 'org-1' },
        order: ['created_at', { ascending: false }],
        limit: 1000,
      },
    ])
  })

  it('shows type, number, client, French status, dates, and a dash for the total', async () => {
    open('/app/documents')
    await screen.findByText('2 documents')

    const facture = within(card(/^Facture 2026-0007/))
    expect(facture.getByRole('heading', { level: 2 })).toHaveTextContent('Émise')
    expect(facture.getByText('Numéro').nextElementSibling).toHaveTextContent('2026-0007')
    // The name printed on the issued document, not the client's current name.
    expect(facture.getByText('Client').nextElementSibling).toHaveTextContent('Élan SARL (ancien nom)')
    // The first of January stays the first of January.
    expect(facture.getByText("Date d'émission").nextElementSibling).toHaveTextContent('01/01/2026')
    expect(facture.getByText('Échéance').nextElementSibling).toHaveTextContent('—')
    expect(facture.getByText('Total TTC').nextElementSibling).toHaveTextContent('—')

    const devis = within(card(/^Devis/))
    expect(devis.getByRole('heading', { level: 2 })).toHaveTextContent('Brouillon')
    expect(devis.getByText('Numéro').nextElementSibling).toHaveTextContent('Sans numéro')
    expect(devis.getByText('Client').nextElementSibling).toHaveTextContent('Société Élan')
    expect(devis.getByText("Date d'émission").nextElementSibling).toHaveTextContent('—')
    expect(devis.getByText('Échéance').nextElementSibling).toHaveTextContent('12/11/2026')
  })

  it('filters by type and by status, in the query and in the address', async () => {
    const { router } = open('/app/documents')
    await screen.findByText('2 documents')
    await user.selectOptions(screen.getByLabelText('Type'), 'facture')
    expect(await screen.findByText('1 document')).toBeInTheDocument()
    expect(location(router)).toBe('/app/documents?type=facture')
    expect(listCalls().at(-1)?.filters).toEqual({ organization_id: 'org-1', type: 'facture' })
    expect(screen.queryByRole('heading', { level: 2, name: /^Devis/ })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Statut'), 'draft')
    expect(await screen.findByText('Aucun document ne correspond à ces filtres.')).toBeInTheDocument()
    expect(location(router)).toBe('/app/documents?type=facture&status=draft')
    expect(listCalls().at(-1)?.filters).toEqual({ organization_id: 'org-1', type: 'facture', status: 'draft' })

    await user.selectOptions(screen.getByLabelText('Type'), '')
    expect(await screen.findByText('1 document')).toBeInTheDocument()
    expect(listCalls().at(-1)?.filters).toEqual({ organization_id: 'org-1', status: 'draft' })
  })

  it('ignores filter values it does not know (they come from the address)', async () => {
    open('/app/documents?type=avoir&status=overdue')
    await screen.findByText('2 documents')
    expect(listCalls().at(-1)?.filters).toEqual({ organization_id: 'org-1' })
    expect(screen.getByLabelText('Type')).toHaveValue('')
  })

  it('says so when there is no document at all', async () => {
    list = []
    open('/app/documents')
    expect(await screen.findByText(/^Aucun document pour le moment\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nouveau devis' })).toHaveAttribute('href', '/app/documents/new?type=devis')
    expect(screen.getByRole('link', { name: 'Nouvelle facture' })).toHaveAttribute('href', '/app/documents/new?type=facture')
  })

  it('warns that the list may be incomplete when the 1000 row limit is reached', async () => {
    list = Array.from({ length: 1000 }, (_, index) => ({ ...draftRow, id: `id-${index}` }))
    const full = open('/app/documents')
    expect(await screen.findByText(/^Seuls les 1000 documents les plus récents sont chargés/)).toBeInTheDocument()
    full.unmount()
    list = list.slice(0, 999)
    open('/app/documents')
    expect(await screen.findByText('999 documents')).toBeInTheDocument()
    expect(screen.queryByText(/^Seuls les 1000 documents/)).not.toBeInTheDocument()
    // Rendering 1000 cards twice in jsdom takes several seconds: the default 5 s limit of a
    // test is too short on a busy machine. The assertions are unchanged.
  }, 60_000)

  it('shows a French error and a retry when the list cannot be loaded', async () => {
    let fail = true
    override = (call) => (call.table === 'documents' && fail ? failed({ code: '42P01', message: 'relation "public.documents" does not exist' }) : undefined)
    open('/app/documents')
    expect(await screen.findByRole('alert')).toHaveTextContent("Les documents n'ont pas pu être chargés.")
    expect(screen.queryByText(/relation|public\.documents/)).not.toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('2 documents')).toBeInTheDocument()
  })

  it('renders a hostile client name as plain text', async () => {
    const hostile = '<img src=x onerror=alert(1)><b>Client</b>'
    list = [{ ...draftRow, client: { name: hostile } }]
    const { container } = open('/app/documents')
    expect(await screen.findByText(hostile)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('deleting a draft', () => {
  it('is offered for a draft only', async () => {
    open('/app/documents')
    await screen.findByText('2 documents')
    expect(within(card(/^Devis/)).getByRole('button', { name: /^Supprimer/ })).toBeInTheDocument()
    expect(within(card(/^Devis/)).getByRole('link', { name: /^Modifier/ })).toHaveAttribute('href', `/app/documents/${DRAFT}`)
    expect(within(card(/^Facture/)).queryByRole('button', { name: /Supprimer/ })).not.toBeInTheDocument()
    expect(within(card(/^Facture/)).getByRole('link', { name: /^Ouvrir/ })).toHaveAttribute('href', `/app/documents/${SENT}`)
  })

  it('asks for a confirmation first, and cancelling deletes nothing', async () => {
    open('/app/documents')
    await user.click(await screen.findByRole('button', { name: 'Supprimer : Devis en brouillon, Société Élan' }))
    expect(screen.getByText('Supprimer définitivement ce brouillon (Devis en brouillon, Société Élan) ?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus()
    expect(documentCalls('delete')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('button', { name: 'Confirmer la suppression' })).not.toBeInTheDocument()
    expect(documentCalls('delete')).toEqual([])
  })

  it('deletes that document in the current organization and detects "no row deleted"', async () => {
    override = (call) => {
      if (call.table === 'documents' && call.op === 'delete') list = list.filter((row) => row.id !== call.filters.id)
      return undefined
    }
    open('/app/documents')
    await user.click(await screen.findByRole('button', { name: /^Supprimer : Devis/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    expect(await screen.findByText('1 document')).toBeInTheDocument()
    expect(documentCalls('delete')).toEqual([
      { table: 'documents', op: 'delete', filters: { organization_id: 'org-1', id: DRAFT }, columns: 'id', ending: 'single' },
    ])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says the document is no longer a draft when nothing was deleted', async () => {
    override = (call) => (call.table === 'documents' && call.op === 'delete' ? failed(NO_ROW) : undefined)
    open('/app/documents')
    await user.click(await screen.findByRole('button', { name: /^Supprimer : Devis/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Rien n'a été modifié : ce document n'est plus un brouillon, ou il n'existe plus.")
    expect(screen.queryByText(/JSON object|0 rows/)).not.toBeInTheDocument()
  })

  it('maps a database refusal to French (DF010), never the raw message', async () => {
    override = (call) =>
      call.table === 'documents' && call.op === 'delete' ? failed({ code: 'DF010', message: 'a sent document cannot be deleted' }) : undefined
    open('/app/documents')
    await user.click(await screen.findByRole('button', { name: /^Supprimer : Devis/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Un document émis ne peut pas être supprimé.')
    expect(screen.queryByText(/a sent document/)).not.toBeInTheDocument()
  })
})

describe('creating a draft', () => {
  it('takes the type from the address and creates the draft with the allowed columns only', async () => {
    const { router } = open('/app/documents/new?type=facture')
    expect(await screen.findByRole('heading', { level: 1, name: 'Nouvelle facture' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Type de document')).not.toBeInTheDocument()
    await user.selectOptions(await screen.findByLabelText('Client'), ELAN)
    await user.type(screen.getByLabelText("Date d'émission"), '2026-10-13')
    await user.type(screen.getByLabelText("Date d'échéance"), '2026-11-12')
    await user.type(screen.getByLabelText('Notes'), '  Merci de votre confiance  ')
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))

    await waitFor(() => expect(location(router)).toBe(`/app/documents/${NEW}`))
    const [insert] = documentCalls('insert')
    expect(insert).toEqual({
      table: 'documents',
      op: 'insert',
      filters: {},
      columns: 'id',
      ending: 'single',
      payload: {
        organization_id: 'org-1',
        type: 'facture',
        client_id: ELAN,
        // The day typed is the day sent: plain text, no time zone.
        issue_date: '2026-10-13',
        due_date: '2026-11-12',
        notes: 'Merci de votre confiance',
      },
    })
    expect(Object.keys(insert?.payload ?? {}).sort()).toEqual(['client_id', 'due_date', 'issue_date', 'notes', 'organization_id', 'type'])
  })

  it('keeps the first of January the first of January', async () => {
    open('/app/documents/new?type=devis')
    await user.selectOptions(await screen.findByLabelText('Client'), BECHIR)
    await user.type(screen.getByLabelText("Date d'émission"), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    await waitFor(() => expect(documentCalls('insert')).toHaveLength(1))
    expect(documentCalls('insert')[0]?.payload).toMatchObject({ type: 'devis', issue_date: '2026-01-01', due_date: null, notes: null })
  })

  it('offers a choice when the type in the address is missing or unknown', async () => {
    open('/app/documents/new?type=avoir')
    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau document' })).toBeInTheDocument()
    const type = await screen.findByLabelText('Type de document')
    expect(type).toHaveValue('')
    await user.selectOptions(screen.getByLabelText('Client'), ELAN)
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    expect(type).toHaveAccessibleDescription('Choisissez le type de document.')
    expect(documentCalls('insert')).toEqual([])
    await user.selectOptions(type, 'devis')
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    await waitFor(() => expect(documentCalls('insert')).toHaveLength(1))
    expect(documentCalls('insert')[0]?.payload).toMatchObject({ type: 'devis' })
  })

  it('requires a client', async () => {
    open('/app/documents/new?type=devis')
    await screen.findByLabelText('Client')
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    expect(screen.getByLabelText('Client')).toBeInvalid()
    expect(screen.getByLabelText('Client')).toHaveAccessibleDescription('Choisissez un client.')
    expect(documentCalls('insert')).toEqual([])
  })

  it('refuses a due date before the issue date, without calling the database', async () => {
    open('/app/documents/new?type=devis')
    await user.selectOptions(await screen.findByLabelText('Client'), ELAN)
    await user.type(screen.getByLabelText("Date d'émission"), '2026-10-13')
    await user.type(screen.getByLabelText("Date d'échéance"), '2026-10-12')
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    expect(screen.getByLabelText("Date d'échéance")).toHaveAccessibleDescription(/La date d'échéance ne peut pas précéder la date d'émission\./)
    expect(documentCalls('insert')).toEqual([])
  })

  it('links to the client creation when the organization has no client', async () => {
    storedClients = []
    open('/app/documents/new?type=devis')
    expect(await screen.findByText(/Vous n'avez encore aucun client\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Créer un client' })).toHaveAttribute('href', '/app/clients/new')
    expect(screen.queryByRole('button', { name: 'Créer le brouillon' })).not.toBeInTheDocument()
  })

  it('asks for the clients of the current organization', async () => {
    open('/app/documents/new?type=devis')
    await screen.findByLabelText('Client')
    expect(api.calls.find((call) => call.table === 'clients')?.filters).toEqual({ organization_id: 'org-1' })
    expect(within(screen.getByLabelText('Client')).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choisir un client…',
      'Béchir Trabelsi',
      'Société Élan',
    ])
  })

  it('shows a French message when the database refuses, and stays on the form', async () => {
    override = (call) =>
      call.table === 'documents' && call.op === 'insert'
        ? failed({ code: '42501', message: 'permission denied for column status of relation documents' })
        : undefined
    const { router } = open('/app/documents/new?type=devis')
    await user.selectOptions(await screen.findByLabelText('Client'), ELAN)
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Vous n'avez pas les droits nécessaires pour cette action.")
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument()
    expect(location(router)).toBe('/app/documents/new?type=devis')
  })

  it('says the client no longer exists when it was deleted meanwhile (23503)', async () => {
    override = (call) =>
      call.table === 'documents' && call.op === 'insert'
        ? failed({ code: '23503', message: 'insert or update on table "documents" violates foreign key constraint "documents_client_fk"' })
        : undefined
    open('/app/documents/new?type=devis')
    await user.selectOptions(await screen.findByLabelText('Client'), ELAN)
    await user.click(screen.getByRole('button', { name: 'Créer le brouillon' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Ce client n'existe plus. Choisissez-en un autre.")
  })
})

describe('editing the header of a draft', () => {
  it('shows the stored values and updates only client, dates and notes', async () => {
    open(`/app/documents/${DRAFT}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Devis en brouillon' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Client')).toHaveValue(ELAN)
    expect(screen.getByLabelText("Date d'émission")).toHaveValue('')
    expect(screen.getByLabelText("Date d'échéance")).toHaveValue('2026-11-12')
    expect(screen.getByLabelText('Notes')).toHaveValue('À confirmer')
    // The type of an existing draft cannot be changed.
    expect(screen.queryByLabelText('Type de document')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Client'), BECHIR)
    await user.type(screen.getByLabelText("Date d'émission"), '2026-10-13')
    await user.clear(screen.getByLabelText('Notes'))
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))

    expect(await screen.findByText('Brouillon enregistré.')).toBeInTheDocument()
    expect(documentCalls('update')).toEqual([
      {
        table: 'documents',
        op: 'update',
        payload: { client_id: BECHIR, issue_date: '2026-10-13', due_date: '2026-11-12', notes: null },
        filters: { organization_id: 'org-1', id: DRAFT },
        columns: 'id',
        ending: 'single',
      },
    ])
  })

  it('reads the document of the current organization with explicit columns', async () => {
    open(`/app/documents/${DRAFT}`)
    await screen.findByLabelText('Client')
    const read = documentCalls('select').find((call) => 'id' in call.filters)
    expect(read?.filters).toEqual({ organization_id: 'org-1', id: DRAFT })
    expect(read?.columns).toBe(
      'id, type, number, year, status, client_id, issue_date, due_date, notes, buyer_name, buyer_matricule_fiscal, buyer_address',
    )
  })

  it('says the document is no longer a draft when the update matched no row', async () => {
    override = (call) => (call.table === 'documents' && call.op === 'update' ? failed(NO_ROW) : undefined)
    open(`/app/documents/${DRAFT}`)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer le brouillon' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Rien n'a été modifié : ce document n'est plus un brouillon, ou il n'existe plus.")
    expect(screen.queryByText('Brouillon enregistré.')).not.toBeInTheDocument()
    expect(screen.queryByText(/JSON object/)).not.toBeInTheDocument()
  })

  it('refuses a due date before the issue date', async () => {
    open(`/app/documents/${DRAFT}`)
    await user.type(await screen.findByLabelText("Date d'émission"), '2026-12-01')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }))
    expect(screen.getByLabelText("Date d'échéance")).toHaveAccessibleDescription(/ne peut pas précéder/)
    expect(documentCalls('update')).toEqual([])
  })

  it('says not found for an unknown id, and never sends a non-uuid to the database', async () => {
    const first = open('/app/documents/dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce document est introuvable.')
    first.unmount()
    api.calls.length = 0
    open('/app/documents/not-a-uuid')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce document est introuvable.')
    expect(api.calls.filter((call) => call.table === 'documents')).toEqual([])
  })
})

describe('a document that is no longer a draft', () => {
  it('is shown read-only, from its snapshot: no form, no save, no delete', async () => {
    open(`/app/documents/${SENT}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Facture 2026-0007' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Ce document a été émis : il ne peut plus être modifié.')
    expect(screen.getByText('Statut').nextElementSibling).toHaveTextContent('Émise')
    expect(screen.getByText('Client').nextElementSibling).toHaveTextContent('Élan SARL (ancien nom)')
    expect(screen.getByText('Matricule fiscal').nextElementSibling).toHaveTextContent('1234567/A/M/000')
    expect(screen.getByText('Adresse').nextElementSibling).toHaveTextContent('12 rue de Carthage')
    expect(screen.getByText("Date d'émission").nextElementSibling).toHaveTextContent('01/01/2026')
    expect(screen.getByText('Échéance').nextElementSibling).toHaveTextContent('—')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Enregistrer|Supprimer/ })).not.toBeInTheDocument()
    // The clients are not even loaded: nothing can be chosen.
    expect(api.calls.filter((call) => call.table === 'clients')).toEqual([])
  })

  it.each([
    ['paid', 'Payée'],
    ['cancelled', 'Annulée'],
  ])('shows the status %s in French', async (status, label) => {
    details[SENT] = { ...sentDetail, status }
    open(`/app/documents/${SENT}`)
    await screen.findByRole('heading', { level: 1, name: 'Facture 2026-0007' })
    expect(screen.getByText('Statut').nextElementSibling).toHaveTextContent(label)
    expect(screen.queryByRole('button', { name: /Enregistrer/ })).not.toBeInTheDocument()
  })
})
