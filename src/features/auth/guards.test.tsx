import { screen } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'
import { authState, fakeSession, renderRoutes } from '../../test/helpers'
import { RedirectIfAuthed, RequireAuth } from './guards'

const routes: RouteObject[] = [
  { element: <RedirectIfAuthed />, children: [{ path: '/login', element: <p>login page</p> }] },
  {
    element: <RequireAuth />,
    children: [
      { path: '/app', element: <p>app home</p> },
      { path: '/app/clients', element: <p>clients page</p> },
    ],
  },
  { path: '*', element: <p>somewhere else</p> },
]
const loggedIn = authState({ session: fakeSession() })
const location = (router: { state: { location: { pathname: string; search: string } } }) =>
  `${router.state.location.pathname}${router.state.location.search}`

describe('RequireAuth', () => {
  it('sends a visitor without a session to /login and remembers where they were going', () => {
    const { router } = renderRoutes(routes, '/app/clients?q=a', authState())
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(location(router)).toBe(`/login?next=${encodeURIComponent('/app/clients?q=a')}`)
  })

  it('shows the private page to a logged-in user', () => {
    renderRoutes(routes, '/app', loggedIn)
    expect(screen.getByText('app home')).toBeInTheDocument()
  })

  it('shows neither page while the session is still being read', () => {
    renderRoutes(routes, '/app', authState({ isLoading: true }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('app home')).not.toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })
})

describe('RedirectIfAuthed', () => {
  it('lets a visitor without a session see the login page', () => {
    renderRoutes(routes, '/login', authState())
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('sends a logged-in user to /app by default', () => {
    const { router } = renderRoutes(routes, '/login', loggedIn)
    expect(location(router)).toBe('/app')
  })

  it('follows ?next= when it is a path inside the app', () => {
    const { router } = renderRoutes(routes, `/login?next=${encodeURIComponent('/app/clients')}`, loggedIn)
    expect(screen.getByText('clients page')).toBeInTheDocument()
    expect(location(router)).toBe('/app/clients')
  })

  it.each([
    '//evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '/\\evil.com',
    '/%2F%2Fevil.com',
    '/%5Cevil.com',
  ])('ignores the hostile ?next=%s and goes to /app', (next) => {
    const { router } = renderRoutes(routes, `/login?next=${encodeURIComponent(next)}`, loggedIn)
    expect(location(router)).toBe('/app')
    expect(screen.getByText('app home')).toBeInTheDocument()
  })
})
