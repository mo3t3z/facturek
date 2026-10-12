import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthState = {
  session: Session | null
  /** True until the stored session (if any) has been read. */
  isLoading: boolean
  /**
   * True only while the user is in the middle of a password recovery: they have just
   * confirmed a recovery link in THIS tab and have not chosen a new password yet.
   * Kept in memory on purpose: a reload or another tab does not inherit it.
   */
  isRecovering: boolean
  beginRecovery: () => void
  endRecovery: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
