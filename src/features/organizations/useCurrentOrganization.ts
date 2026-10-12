import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/context'

export type CurrentOrganization = { id: string; name: string }

/**
 * The organization of the logged-in user.
 *
 * Step 1: supabase.rpc('ensure_my_account'). The database creates the account if the
 *         signup trigger could not (it never blocks a signup) and returns the id of the
 *         user's organization. The frontend never inserts profile, organization or
 *         membership rows.
 * Step 2: read that organization (RLS only returns it to its members).
 *
 * The query key is the user id and the result never goes stale, so this runs ONCE per
 * login or restored session: re-renders and token refreshes do not call the RPC again.
 * There is no automatic retry; the screen offers a retry button (refetch).
 */
export function useCurrentOrganization() {
  const { session } = useAuth()
  const userId = session?.user.id

  return useQuery({
    queryKey: ['organizations', 'current', userId],
    enabled: userId !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<CurrentOrganization> => {
      const account = await supabase.rpc('ensure_my_account')
      if (account.error) throw account.error
      if (!account.data) throw new Error('ensure_my_account returned no organization')

      const organization = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', account.data)
        .maybeSingle()
      if (organization.error) throw organization.error
      if (!organization.data) throw new Error('organization not readable')
      return organization.data
    },
  })
}
