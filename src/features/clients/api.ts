import { supabase } from '../../lib/supabase'
import type { ClientValues } from './schemas'

// Every call names the organization explicitly. RLS already limits a user to the
// organizations they belong to, but RLS answers "may this user see the row?", not "is
// this the organization on screen?". The filter keeps the two questions separate.

const COLUMNS = 'id, name, matricule_fiscal, address, email, phone'

export type Client = {
  id: string
  name: string
  matricule_fiscal: string | null
  address: string | null
  email: string | null
  phone: string | null
}

export const clientsKey = (organizationId: string) => ['clients', organizationId] as const

/** Form values to table columns: an empty optional field is stored as NULL. */
function toRow(values: ClientValues) {
  return {
    name: values.name,
    matricule_fiscal: values.matricule_fiscal || null,
    address: values.address || null,
    email: values.email || null,
    phone: values.phone || null,
  }
}

export async function listClients(organizationId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .order('name')
  if (error) throw error
  return data
}

/** Returns null when the client does not exist in this organization. */
export async function getClient(organizationId: string, clientId: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createClient(organizationId: string, values: ClientValues): Promise<void> {
  const { error } = await supabase.from('clients').insert({ organization_id: organizationId, ...toRow(values) })
  if (error) throw error
}

/** Fails with PGRST116 when no row was updated (client deleted in the meantime). */
export async function updateClient(organizationId: string, clientId: string, values: ClientValues): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update(toRow(values))
    .eq('organization_id', organizationId)
    .eq('id', clientId)
    .select('id')
    .single()
  if (error) throw error
}

/** A client referenced by a document cannot be deleted: Postgres answers 23503. */
export async function deleteClient(organizationId: string, clientId: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', clientId)
  if (error) throw error
}
