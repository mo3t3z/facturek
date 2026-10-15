import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, fakeSession, newQueryClient, Providers } from '../test/helpers'

// The real client is replaced: no network, and every call the screen makes is recorded.
const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: { rpc: api.rpc, from: api.from, auth: { signOut: api.signOut } },
}))

import { AppHomePage } from './AppHomePage'
import { AppLayout } from './AppLayout'

const ok = <T,>(data: T) => ({ data, error: null })
const failed = (error: object) => ({ data: null, error })
const user = userEvent.setup({ delay: null })

beforeEach(() => {
  vi.clearAllMocks()
  api.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: api.maybeSingle }) }) }))
  api.signOut.mockResolvedValue({ error: null })
})

function renderHome(session = fakeSession()) {
  const client = newQueryClient()
  // The dashboard is rendered where it lives: inside the app shell, which owns the
  // sign-out button.
  const ui = (s: ReturnType<typeof fakeSession>) => (
    <Providers auth={authState({ session: s })} client={client}>
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/app" element={<AppHomePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Providers>
  )
  const view = render(ui(session))
  return { ...view, rerenderWith: (s: ReturnType<typeof fakeSession>) => view.rerender(ui(s)) }
}

describe('after login', () => {
  it('calls ensure_my_account, then shows the organization name', async () => {
    api.rpc.mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok({ id: 'org-1', name: 'Atelier Amel' }))
    renderHome()
    expect(await screen.findByText('Atelier Amel')).toBeInTheDocument()
    expect(api.rpc).toHaveBeenCalledWith('ensure_my_account')
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
  })

  it('calls ensure_my_account exactly once, across re-renders and token refreshes', async () => {
    api.rpc.mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok({ id: 'org-1', name: 'Atelier Amel' }))
    const { rerenderWith } = renderHome(fakeSession('user-1', 'token-1'))
    await screen.findByText('Atelier Amel')
    rerenderWith(fakeSession('user-1', 'token-1'))
    // A refreshed token is a new session object for the SAME user.
    rerenderWith(fakeSession('user-1', 'token-2'))
    rerenderWith(fakeSession('user-1', 'token-3'))
    await screen.findByText('Atelier Amel')
    expect(api.rpc).toHaveBeenCalledTimes(1)
  })

  it('calls it again for a different user', async () => {
    api.rpc.mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok({ id: 'org-1', name: 'Atelier Amel' }))
    const { rerenderWith } = renderHome(fakeSession('user-1'))
    await screen.findByText('Atelier Amel')
    rerenderWith(fakeSession('user-2'))
    await waitFor(() => expect(api.rpc).toHaveBeenCalledTimes(2))
  })

  it('only reads: it never inserts a profile, an organization or a membership', async () => {
    api.rpc.mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok({ id: 'org-1', name: 'Atelier Amel' }))
    renderHome()
    await screen.findByText('Atelier Amel')
    expect(api.from.mock.calls.map(([table]) => table)).toEqual(['organizations'])
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(['ensure_my_account'])
  })

  it('renders a hostile organization name as plain text', async () => {
    const hostile = '<img src=x onerror=alert(1)><b>Atelier</b>'
    api.rpc.mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok({ id: 'org-1', name: hostile }))
    const { container } = renderHome()
    expect(await screen.findByText(hostile)).toBeInTheDocument()
    // The shell has its own logo image; what must not exist is the one from the text.
    expect(container.querySelector('img[src="x"], img[onerror]')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
  })
})

describe('when the account cannot be prepared', () => {
  it('shows a French error and a retry button, never the raw database message', async () => {
    api.rpc.mockResolvedValue(failed({ code: 'XX000', message: 'relation "public.organizations" does not exist' }))
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent("Votre espace n'a pas pu être préparé.")
    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur est survenue.')
    expect(screen.queryByText(/relation|public\.organizations|XX000/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
    // The rest of the screen still works.
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
    // No automatic retry behind the user's back.
    expect(api.rpc).toHaveBeenCalledTimes(1)
  })

  it('retries when the button is pressed and recovers', async () => {
    api.rpc.mockResolvedValueOnce(failed({ code: 'XX000', message: 'boom' })).mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok({ id: 'org-1', name: 'Atelier Amel' }))
    renderHome()
    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Atelier Amel')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.rpc).toHaveBeenCalledTimes(2)
  })

  it('does not crash when the request itself throws (server unreachable)', async () => {
    api.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion au serveur impossible.')
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('copes with a user who has no organization: RPC ok but nothing readable', async () => {
    api.rpc.mockResolvedValue(ok('org-1'))
    api.maybeSingle.mockResolvedValue(ok(null))
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent("Votre espace n'a pas pu être préparé.")
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('copes with ensure_my_account returning nothing', async () => {
    api.rpc.mockResolvedValue(ok(null))
    renderHome()
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
    expect(api.from).not.toHaveBeenCalled()
  })

  it('still lets the user sign out', async () => {
    api.rpc.mockResolvedValue(failed({ code: 'XX000', message: 'boom' }))
    renderHome()
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(api.signOut).toHaveBeenCalledTimes(1)
  })
})
