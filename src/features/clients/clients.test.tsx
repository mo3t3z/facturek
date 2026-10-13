import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'

// The real client is replaced by a recorder: no network, and every query the screens
// build is kept (table, operation, payload, filters) so the tests can check it.
type Call = {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  payload?: unknown
  limit?: number
  filters: Record<string, unknown>
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
    const query = {
      select: () => query,
      order: () => query,
      limit: (count: number) => {
        call.limit = count
        return query
      },
      insert: (payload: unknown) => {
        call.op = 'insert'
        call.payload = payload
        return query
      },
      update: (payload: unknown) => {
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
      single: run,
      maybeSingle: run,
      // A query builder is awaited directly when no .single() / .maybeSingle() ends it.
      then: (onOk: (value: Result) => unknown, onError: (reason: unknown) => unknown) => run().then(onOk, onError),
    }
    return query
  }
  return { supabase: { from, rpc: api.rpc, auth: { signOut: api.signOut } } }
})

import { routes } from '../../app/router'

const AMEL = '11111111-1111-4111-8111-111111111111'
const BECHIR = '22222222-2222-4222-8222-222222222222'
const amel = {
  id: AMEL,
  name: 'Société Élan',
  matricule_fiscal: '1234567/A/M/000',
  address: '12 rue de Carthage, Tunis',
  email: 'contact@elan.tn',
  phone: '71 123 456',
}
const bechir = { id: BECHIR, name: 'Béchir Trabelsi', matricule_fiscal: null, address: null, email: null, phone: '98 765 432' }

const ok = (data: unknown): Result => ({ data, error: null })
const failed = (error: object): Result => ({ data: null, error })
const user = userEvent.setup({ delay: null })

let stored: (typeof amel | typeof bechir)[]
/** Lets one test replace the answer to the clients queries it cares about. */
let override: (call: Call) => Result | undefined

beforeEach(() => {
  vi.clearAllMocks()
  api.calls.length = 0
  stored = [bechir, amel]
  override = () => undefined
  api.rpc.mockResolvedValue(ok('org-1'))
  api.signOut.mockResolvedValue({ error: null })
  api.respond.mockImplementation((call) => {
    if (call.table === 'organizations') return ok({ id: 'org-1', name: 'Atelier Amel' })
    const special = override(call)
    if (special) return special
    if (call.op === 'select' && 'id' in call.filters) {
      return ok(stored.find((client) => client.id === call.filters.id) ?? null)
    }
    if (call.op === 'select') return ok(stored)
    if (call.op === 'update') return ok({ id: call.filters.id })
    return ok(null)
  })
})

function open(path: string) {
  return renderRoutes(routes, path, authState({ session: fakeSession() }))
}
const clientCalls = (op: Call['op']) => api.calls.filter((call) => call.table === 'clients' && call.op === op)
const path = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname

describe('app shell', () => {
  it('shows the navigation with the current page marked, and the skip link', async () => {
    open('/app/clients')
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getByRole('link', { name: 'Clients' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Tableau de bord' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute('href', '#contenu')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenu')
    await screen.findByRole('heading', { level: 1, name: 'Clients' })
  })

  it('navigates between the dashboard and the clients', async () => {
    const { router } = open('/app')
    await user.click(screen.getByRole('link', { name: 'Clients' }))
    expect(path(router)).toBe('/app/clients')
    await user.click(screen.getByRole('link', { name: 'Tableau de bord' }))
    expect(path(router)).toBe('/app')
  })

  it('signs out from any screen', async () => {
    open('/app/clients')
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(api.signOut).toHaveBeenCalledTimes(1)
  })

  it('sends a visitor without a session to the login page', () => {
    const { router } = renderRoutes(routes, '/app/clients', authState())
    expect(path(router)).toBe('/login')
    expect(api.calls).toEqual([])
  })

  it('offers a retry instead of the clients when the account cannot be prepared', async () => {
    api.rpc.mockResolvedValueOnce(failed({ code: 'XX000', message: 'boom' })).mockResolvedValue(ok('org-1'))
    open('/app/clients')
    expect(await screen.findByRole('alert')).toHaveTextContent("Votre espace n'a pas pu être préparé.")
    expect(clientCalls('select')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Société Élan')).toBeInTheDocument()
  })
})

describe('clients list', () => {
  it('lists the clients of the current organization only', async () => {
    open('/app/clients')
    expect(await screen.findByRole('heading', { level: 2, name: 'Société Élan' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Béchir Trabelsi' })).toBeInTheDocument()
    expect(screen.getByText('1234567/A/M/000')).toBeInTheDocument()
    expect(screen.getByText('2 clients')).toBeInTheDocument()
    // The organization is named in the query itself, not left to RLS alone.
    expect(clientCalls('select')).toEqual([
      { table: 'clients', op: 'select', limit: 1000, filters: { organization_id: 'org-1' } },
    ])
    expect(screen.queryByText(/liste et la recherche peuvent être incomplètes/)).not.toBeInTheDocument()
  })

  it('searches without accents or case, in the name, the phone and the matricule', async () => {
    open('/app/clients')
    const search = await screen.findByRole('searchbox', { name: 'Rechercher un client' })
    await screen.findByText('Société Élan')

    await user.type(search, 'societe ELAN')
    expect(screen.getByText('Société Élan')).toBeInTheDocument()
    expect(screen.queryByText('Béchir Trabelsi')).not.toBeInTheDocument()
    expect(screen.getByText('1 client')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '98 765')
    expect(screen.getByText('Béchir Trabelsi')).toBeInTheDocument()
    expect(screen.queryByText('Société Élan')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '1234567')
    expect(screen.getByText('Société Élan')).toBeInTheDocument()

    // Searching never goes back to the database, so the text never reaches a filter.
    expect(clientCalls('select')).toHaveLength(1)
  })

  it('says so when nothing matches, and when there is no client at all', async () => {
    const first = open('/app/clients')
    await user.type(await screen.findByRole('searchbox'), 'zzz')
    expect(screen.getByText('Aucun client ne correspond à cette recherche.')).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: /./ })).not.toBeInTheDocument()
    first.unmount()

    stored = []
    open('/app/clients')
    expect(await screen.findByText('Aucun client pour le moment. Ajoutez votre premier client.')).toBeInTheDocument()
  })

  it('shows a French error and a retry when the list cannot be loaded, never the raw message', async () => {
    let fail = true
    override = (call) =>
      call.op === 'select' && fail ? failed({ code: '42P01', message: 'relation "public.clients" does not exist' }) : undefined
    open('/app/clients')
    expect(await screen.findByRole('alert')).toHaveTextContent("La liste des clients n'a pas pu être chargée.")
    expect(screen.queryByText(/relation|public\.clients|42P01/)).not.toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Société Élan')).toBeInTheDocument()
  })

  it('warns that the list may be incomplete when the 1000 row limit is reached', async () => {
    stored = Array.from({ length: 1000 }, (_, index) => ({ ...bechir, id: `id-${index}`, name: `Client ${index}` }))
    const full = open('/app/clients')
    expect(await screen.findByText(/^Seuls les 1000 premiers clients/)).toHaveTextContent(
      'Seuls les 1000 premiers clients (par ordre alphabétique) sont chargés : la liste et la recherche peuvent être incomplètes.',
    )
    // The warning stays while searching: that is when a missing client would mislead.
    await user.type(screen.getByRole('searchbox'), 'Client 999')
    expect(screen.getByText('1 client')).toBeInTheDocument()
    expect(screen.getByText(/^Seuls les 1000 premiers clients/)).toBeInTheDocument()
    full.unmount()

    stored = stored.slice(0, 999)
    open('/app/clients')
    expect(await screen.findByText('999 clients')).toBeInTheDocument()
    expect(screen.queryByText(/^Seuls les 1000 premiers clients/)).not.toBeInTheDocument()
    // Rendering 1000 cards twice in jsdom takes several seconds: the default 5 s limit of a
    // test is too short on a busy machine. The assertions are unchanged.
  }, 60_000)

  it('renders a hostile client name as plain text', async () => {
    const hostile = '<img src=x onerror=alert(1)><b>Client</b>'
    stored = [{ ...bechir, name: hostile }]
    const { container } = open('/app/clients')
    expect(await screen.findByText(hostile)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })
})

describe('creating a client', () => {
  it('requires a name and refuses an invalid e-mail, in French, without calling the database', async () => {
    open('/app/clients/new')
    await user.type(await screen.findByLabelText('Adresse e-mail'), 'pas-un-email')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le client' }))

    const name = screen.getByLabelText('Nom ou raison sociale')
    expect(name).toBeInvalid()
    expect(name).toHaveAccessibleDescription('Ce champ est obligatoire.')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveAccessibleDescription(/Adresse e-mail invalide\./)
    expect(clientCalls('insert')).toEqual([])
  })

  it('refuses a name made of spaces only', async () => {
    open('/app/clients/new')
    await user.type(await screen.findByLabelText('Nom ou raison sociale'), '   ')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le client' }))
    expect(screen.getByLabelText('Nom ou raison sociale')).toHaveAccessibleDescription('Ce champ est obligatoire.')
    expect(clientCalls('insert')).toEqual([])
  })

  it('inserts into the current organization, trimmed, with empty fields stored as NULL', async () => {
    const { router } = open('/app/clients/new')
    await user.type(await screen.findByLabelText('Nom ou raison sociale'), '  Garage Ben Salah  ')
    await user.type(screen.getByLabelText('Téléphone'), ' 22 333 444 ')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le client' }))

    await waitFor(() => expect(path(router)).toBe('/app/clients'))
    expect(clientCalls('insert')).toEqual([
      {
        table: 'clients',
        op: 'insert',
        filters: {},
        payload: {
          organization_id: 'org-1',
          name: 'Garage Ben Salah',
          matricule_fiscal: null,
          address: null,
          email: null,
          phone: '22 333 444',
        },
      },
    ])
  })

  it('stays on the form and shows a French message when the database refuses', async () => {
    override = (call) =>
      call.op === 'insert'
        ? failed({ code: '42501', message: 'new row violates row-level security policy for table "clients"' })
        : undefined
    const { router } = open('/app/clients/new')
    await user.type(await screen.findByLabelText('Nom ou raison sociale'), 'Garage Ben Salah')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le client' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Vous n'avez pas les droits nécessaires pour cette action.")
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
    expect(path(router)).toBe('/app/clients/new')
    expect(screen.getByLabelText('Nom ou raison sociale')).toHaveValue('Garage Ben Salah')
  })
})

describe('editing a client', () => {
  it('opens from the list with the stored values', async () => {
    const { router } = open('/app/clients')
    await user.click(await screen.findByRole('link', { name: 'Modifier Société Élan' }))
    expect(path(router)).toBe(`/app/clients/${AMEL}/edit`)
    expect(await screen.findByLabelText('Nom ou raison sociale')).toHaveValue('Société Élan')
    expect(screen.getByLabelText('Matricule fiscal')).toHaveValue('1234567/A/M/000')
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('contact@elan.tn')
    expect(clientCalls('select').at(-1)?.filters).toEqual({ organization_id: 'org-1', id: AMEL })
  })

  it('updates that client in the current organization and never sends organization_id', async () => {
    const { router } = open(`/app/clients/${AMEL}/edit`)
    const name = await screen.findByLabelText('Nom ou raison sociale')
    await user.clear(name)
    await user.type(name, 'Élan SARL')
    await user.clear(screen.getByLabelText('Adresse e-mail'))
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }))

    await waitFor(() => expect(path(router)).toBe('/app/clients'))
    expect(clientCalls('update')).toEqual([
      {
        table: 'clients',
        op: 'update',
        filters: { organization_id: 'org-1', id: AMEL },
        payload: {
          name: 'Élan SARL',
          matricule_fiscal: '1234567/A/M/000',
          address: '12 rue de Carthage, Tunis',
          email: null,
          phone: '71 123 456',
        },
      },
    ])
  })

  it('says the client is not found for an unknown id', async () => {
    open('/app/clients/33333333-3333-4333-8333-333333333333/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce client est introuvable.')
    expect(screen.queryByLabelText('Nom ou raison sociale')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Retour aux clients' })).toBeInTheDocument()
  })

  it('never sends an id that is not a uuid to the database', async () => {
    open('/app/clients/not-a-uuid/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce client est introuvable.')
    expect(api.calls.filter((call) => call.table === 'clients')).toEqual([])
  })

  it('says the client is not found when it was deleted while the form was open', async () => {
    override = (call) =>
      call.op === 'update' ? failed({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }) : undefined
    open(`/app/clients/${AMEL}/edit`)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer les modifications' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce client est introuvable.')
    expect(screen.queryByText(/JSON object/)).not.toBeInTheDocument()
  })
})

describe('deleting a client', () => {
  it('asks for a confirmation first, and cancelling deletes nothing', async () => {
    open('/app/clients')
    await user.click(await screen.findByRole('button', { name: 'Supprimer Béchir Trabelsi' }))
    expect(screen.getByText('Supprimer définitivement Béchir Trabelsi ?')).toBeInTheDocument()
    expect(clientCalls('delete')).toEqual([])
    // The keyboard is on the safe choice.
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByText('Supprimer définitivement Béchir Trabelsi ?')).not.toBeInTheDocument()
    expect(clientCalls('delete')).toEqual([])
    expect(screen.getByText('Béchir Trabelsi')).toBeInTheDocument()
  })

  it('deletes that client in the current organization, then reloads the list', async () => {
    override = (call) => {
      if (call.op === 'delete') stored = stored.filter((client) => client.id !== call.filters.id)
      return undefined
    }
    open('/app/clients')
    await user.click(await screen.findByRole('button', { name: 'Supprimer Béchir Trabelsi' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))

    await waitFor(() => expect(screen.queryByText('Béchir Trabelsi')).not.toBeInTheDocument())
    expect(screen.getByText('Société Élan')).toBeInTheDocument()
    expect(clientCalls('delete')).toEqual([
      { table: 'clients', op: 'delete', filters: { organization_id: 'org-1', id: BECHIR } },
    ])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains that a client used by a devis or a facture cannot be deleted', async () => {
    override = (call) =>
      call.op === 'delete'
        ? failed({
            code: '23503',
            message: 'update or delete on table "clients" violates foreign key constraint "documents_client_fk" on table "documents"',
          })
        : undefined
    open('/app/clients')
    await user.click(await screen.findByRole('button', { name: 'Supprimer Société Élan' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ce client est utilisé par au moins un devis ou une facture : il ne peut pas être supprimé.',
    )
    expect(screen.queryByText(/documents_client_fk|foreign key/)).not.toBeInTheDocument()
    // Still there, and the confirmation is closed.
    expect(screen.getByText('Société Élan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmer la suppression' })).not.toBeInTheDocument()
  })

  it('shows the generic French message for any other failure', async () => {
    override = (call) => (call.op === 'delete' ? failed({ code: 'XX000', message: 'internal detail' }) : undefined)
    open('/app/clients')
    await user.click(await screen.findByRole('button', { name: 'Supprimer Société Élan' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Une erreur est survenue.')
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument()
  })
})
