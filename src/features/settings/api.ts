import { dbNumeric } from '../../lib/dbNumeric'
import { fromDbNumeric, fromDbRate, type Millimes, type RateMilli } from '../../lib/money/money'
import { supabase } from '../../lib/supabase'
import type { OrganizationValues } from './schemas'

// Settings of the current organization: its identity (table organizations) and its tax
// settings (table tax_settings, one row per organization, created with the account).
//
// RLS decides who may write: the owner for the organization, the owner or an admin for
// the tax settings. An UPDATE that RLS filters out is NOT an error for PostgREST: it
// simply updates no row. Every update therefore ends with .select(...).single(), which
// fails with PGRST116 when no row came back, so the screen can say that nothing was saved.
//
// The retenue columns of tax_settings are neither read nor written here: the retenue à
// la source is out of Phase 2.

const ORGANIZATION_COLUMNS = 'id, name, matricule_fiscal, address, email, phone'
// Numeric columns are read as TEXT: a JSON number would be a JavaScript float.
// src/test/sourceRules.test.ts refuses any select of these columns without ::text.
const TAX_COLUMNS = 'organization_id, default_tva_rate::text, timbre_enabled, timbre_fiscal::text'

export type OrganizationDetails = {
  id: string
  name: string
  matricule_fiscal: string | null
  address: string | null
  email: string | null
  phone: string | null
}

export type TaxSettings = {
  /** NULL: no default rate has been chosen. */
  defaultTvaRate: RateMilli | null
  timbreEnabled: boolean
  /** NULL: no amount has been entered. */
  timbreFiscal: Millimes | null
}

export const organizationDetailsKey = (organizationId: string) => ['settings', 'organization', organizationId] as const
export const taxSettingsKey = (organizationId: string) => ['settings', 'tax', organizationId] as const

/** Returns null when the organization is not readable (it should always be, for a member). */
export async function getOrganizationDetails(organizationId: string): Promise<OrganizationDetails | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select(ORGANIZATION_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Fails with PGRST116 when no row was updated (not the owner, or the row is gone). */
export async function updateOrganizationDetails(organizationId: string, values: OrganizationValues): Promise<void> {
  const { error } = await supabase
    .from('organizations')
    .update({
      name: values.name,
      // An empty optional field is stored as NULL.
      matricule_fiscal: values.matricule_fiscal || null,
      address: values.address || null,
      email: values.email || null,
      phone: values.phone || null,
    })
    .eq('id', organizationId)
    .select('id')
    .single()
  if (error) throw error
}

/** Returns null when the organization has no tax_settings row. */
export async function getTaxSettings(organizationId: string): Promise<TaxSettings | null> {
  const { data, error } = await supabase
    .from('tax_settings')
    .select(TAX_COLUMNS)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (error) throw error
  if (data === null) return null
  return {
    defaultTvaRate: data.default_tva_rate === null ? null : fromDbRate(data.default_tva_rate),
    timbreEnabled: data.timbre_enabled,
    timbreFiscal: data.timbre_fiscal === null ? null : fromDbNumeric(data.timbre_fiscal),
  }
}

/** Fails with PGRST116 when no row was updated (neither owner nor admin, or no row). */
export async function updateTaxSettings(organizationId: string, settings: TaxSettings): Promise<void> {
  const { error } = await supabase
    .from('tax_settings')
    .update({
      default_tva_rate: dbNumeric(settings.defaultTvaRate),
      timbre_enabled: settings.timbreEnabled,
      timbre_fiscal: dbNumeric(settings.timbreFiscal),
    })
    .eq('organization_id', organizationId)
    .select('organization_id')
    .single()
  if (error) throw error
}
