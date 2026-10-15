import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/context'

// The caller's role in an organization, for the SCREENS only (docs/roles-design.md, R-1).
//
// It decides which buttons are shown, never what is allowed: Postgres checks the role in
// finalize_document, record_payment and cancel_devis (DF026), and RLS guards the settings.
// A screen that shows a button by mistake still gets a refusal; a screen that hides one by
// mistake only loses a convenience.

export type OrgRole = 'owner' | 'admin' | 'member'

const ROLES: readonly string[] = ['owner', 'admin', 'member']
const isOrgRole = (value: unknown): value is OrgRole => typeof value === 'string' && ROLES.includes(value)

export const myRoleKey = (organizationId: string, userId: string | undefined) => ['organizations', organizationId, 'role', userId] as const

/** Issuing, recording a payment and cancelling a devis: owner and admin (R-1). */
export const canCommitDocuments = (role: OrgRole | null) => role === 'owner' || role === 'admin'
/** Tax settings: owner and admin (RLS tax_settings_update). */
export const canEditTaxSettings = (role: OrgRole | null) => role === 'owner' || role === 'admin'
/** Name, matricule, address of the organization: owner only (RLS organizations_update). */
export const canEditOrganization = (role: OrgRole | null) => role === 'owner'

export function useMyRole(organizationId: string) {
  const { session } = useAuth()
  const userId = session?.user.id
  return useQuery({
    queryKey: myRoleKey(organizationId, userId),
    enabled: userId !== undefined,
    retry: false,
    queryFn: async (): Promise<OrgRole> => {
      const { data, error } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', userId ?? '')
        .maybeSingle()
      if (error) throw error
      if (!data || !isOrgRole(data.role)) throw new Error('no readable membership in this organization')
      return data.role
    },
  })
}
