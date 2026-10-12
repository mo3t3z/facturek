import type { Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, type RouteObject, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { AuthContext, type AuthState } from '../features/auth/context'
import '../lib/i18n'

export function fakeSession(userId = 'user-1', accessToken = 'token-1'): Session {
  return { access_token: accessToken, user: { id: userId, email: `${userId}@example.tn` } } as Session
}

export function authState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    session: null,
    isLoading: false,
    isRecovering: false,
    beginRecovery: vi.fn(),
    endRecovery: vi.fn(),
    ...overrides,
  }
}

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } })
}

/** Providers every screen needs, with the auth state chosen by the test. */
export function Providers({ auth, client, children }: { auth: AuthState; client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext value={auth}>{children}</AuthContext>
    </QueryClientProvider>
  )
}

/** Renders routes in a memory router and returns the router so tests can read its location. */
export function renderRoutes(routes: RouteObject[], initialEntry: string, auth: AuthState = authState()) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  const client = newQueryClient()
  const view = render(
    <Providers auth={auth} client={client}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, client, ...view }
}
