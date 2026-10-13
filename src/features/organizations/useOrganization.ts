import { useOutletContext } from 'react-router'
import type { CurrentOrganization } from './useCurrentOrganization'

/** The current organization, for screens rendered under <RequireOrganization>. */
export function useOrganization(): CurrentOrganization {
  return useOutletContext<CurrentOrganization>()
}
