import { supabase } from '../../lib/supabase'
import { documentsKey } from './api'
import { convertDevisPayload } from './payload'
import type { DocumentStatus } from './schemas'

// Converting an issued devis into a draft facture: public.convert_devis_to_facture().
// Postgres does everything in one transaction (the draft, a copy of every line, the link)
// and allows ONE facture per devis (DF025; the index answers 23505 to any other path).
// Like the other functions, the call first checks that the devis belongs to the
// organization of the screen (PGRST116 otherwise), on top of RLS.

/** The facture made from a devis, if there is one. */
export type ConvertedFacture = { id: string; number: number | null; year: number | null; status: DocumentStatus }

export const convertedFactureKey = (organizationId: string, devisId: string) => [...documentsKey(organizationId), 'converted', devisId] as const

export async function findConvertedFacture(organizationId: string, devisId: string): Promise<ConvertedFacture | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, number, year, status')
    .eq('organization_id', organizationId)
    .eq('converted_from', devisId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Returns only the id of the new draft facture. */
export async function convertDevisToFacture(organizationId: string, devisId: string): Promise<{ id: string }> {
  const found = await supabase.from('documents').select('id').eq('organization_id', organizationId).eq('id', devisId).single()
  if (found.error) throw found.error
  const { data, error } = await supabase.rpc('convert_devis_to_facture', convertDevisPayload(devisId))
  if (error) throw error
  return { id: data.id }
}
