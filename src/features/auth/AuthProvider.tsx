import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { AuthContext, type AuthState } from './context'

/**
 * Single source of truth for "who is logged in".
 *
 * supabase-js owns the session: it stores it, refreshes it and tells us about every
 * change through onAuthStateChange (login, logout, token refresh, another tab). We only
 * mirror what it reports. We never read, write or copy a token ourselves.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRecovering, setIsRecovering] = useState(false)
  const currentUserId = useRef<string | null>(null)

  useEffect(() => {
    // Fires once with the stored session (INITIAL_SESSION), then on every change.
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null
      if (currentUserId.current !== null && currentUserId.current !== nextUserId) {
        // Logged out, or another account logged in: nothing fetched for the previous
        // user may stay in memory or be shown to the next one.
        queryClient.clear()
        setIsRecovering(false)
      }
      currentUserId.current = nextUserId
      setSession(nextSession)
      setIsLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const beginRecovery = useCallback(() => setIsRecovering(true), [])
  const endRecovery = useCallback(() => setIsRecovering(false), [])

  const value = useMemo<AuthState>(
    () => ({ session, isLoading, isRecovering, beginRecovery, endRecovery }),
    [session, isLoading, isRecovering, beginRecovery, endRecovery],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
