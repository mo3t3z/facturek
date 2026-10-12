import type { Session } from '@supabase/supabase-js'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSession, newQueryClient } from '../../test/helpers'

type Listener = (event: string, session: Session | null) => void
const auth = vi.hoisted(() => ({
  listener: null as Listener | null,
  unsubscribe: vi.fn(),
  onAuthStateChange: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: auth.onAuthStateChange } } }))

import { AuthProvider } from './AuthProvider'
import { useAuth } from './context'

function Probe() {
  const { session, isLoading, isRecovering, beginRecovery } = useAuth()
  return (
    <div>
      <p data-testid="state">{isLoading ? 'loading' : (session?.user.id ?? 'anonymous')}</p>
      <p data-testid="recovering">{String(isRecovering)}</p>
      <button type="button" onClick={beginRecovery}>
        begin
      </button>
    </div>
  )
}

function renderProvider() {
  const client = newQueryClient()
  const clear = vi.spyOn(client, 'clear')
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { clear, ...view }
}
const emit = (event: string, session: Session | null) => act(() => auth.listener?.(event, session))

beforeEach(() => {
  vi.clearAllMocks()
  auth.listener = null
  auth.onAuthStateChange.mockImplementation((listener: Listener) => {
    auth.listener = listener
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } }
  })
})

describe('AuthProvider', () => {
  it('is loading until supabase-js reports the stored session', () => {
    renderProvider()
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    emit('INITIAL_SESSION', null)
    expect(screen.getByTestId('state')).toHaveTextContent('anonymous')
  })

  it('restores a stored session', () => {
    renderProvider()
    emit('INITIAL_SESSION', fakeSession('user-1'))
    expect(screen.getByTestId('state')).toHaveTextContent('user-1')
  })

  it('follows login, token refresh and logout', () => {
    const { clear } = renderProvider()
    emit('INITIAL_SESSION', null)
    emit('SIGNED_IN', fakeSession('user-1', 'token-1'))
    expect(screen.getByTestId('state')).toHaveTextContent('user-1')
    emit('TOKEN_REFRESHED', fakeSession('user-1', 'token-2'))
    expect(clear).not.toHaveBeenCalled()
    emit('SIGNED_OUT', null)
    expect(screen.getByTestId('state')).toHaveTextContent('anonymous')
  })

  it('drops everything cached for a user when they log out or another user logs in', () => {
    const { clear } = renderProvider()
    emit('INITIAL_SESSION', fakeSession('user-1'))
    emit('SIGNED_OUT', null)
    expect(clear).toHaveBeenCalledTimes(1)
    emit('SIGNED_IN', fakeSession('user-2'))
    expect(clear).toHaveBeenCalledTimes(1)
    emit('SIGNED_IN', fakeSession('user-3'))
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('forgets a recovery in progress when the user changes', () => {
    renderProvider()
    emit('INITIAL_SESSION', fakeSession('user-1'))
    act(() => screen.getByRole('button', { name: 'begin' }).click())
    expect(screen.getByTestId('recovering')).toHaveTextContent('true')
    emit('SIGNED_OUT', null)
    expect(screen.getByTestId('recovering')).toHaveTextContent('false')
  })

  it('subscribes once and unsubscribes when unmounted', () => {
    const { unmount } = renderProvider()
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1)
    unmount()
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
