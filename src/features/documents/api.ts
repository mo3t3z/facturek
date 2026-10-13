import { supabase } from '../../lib/supabase'
import { draftInsertPayload, draftUpdatePayload } from './payload'
import type { DocumentStatus, DocumentType, DraftHeaderValues, NewDraftValues } from './schemas'

// Documents (devis and factures) of the current organization: the list and the header of
// a draft. Items, totals and finalizing come in later checkpoints.
//
// Every call names the organization explicitly, on top of RLS (see clients/api.ts).
// Columns are always listed: select('*') would also return the numeric snapshot columns
// as JSON numbers. No numeric column is read here; `number` and `year` are integers.
//
// RLS lets a member UPDATE or DELETE a document only while it is a draft. On an issued
// document such a statement is NOT an error for PostgREST: it matches no row. Every
// update and delete therefore ends with .select('id').single(), which fails with PGRST116
// when no row came back, so the screen can say "no longer a draft, or not found".

// PostgREST never returns more than max_rows (1000, supabase/config.toml). The list asks
// for exactly that many, so "the list is full" can be detected and told to the user.
export const DOCUMENTS_LIMIT = 1000

// The client's name comes with each row through the foreign key documents_client_fk
// (organization_id, client_id) -> clients (organization_id, id): one request, and it does
// not depend on the clients list, which has its own 1000 row limit.
// buyer_name is the snapshot taken when the document was issued: it wins over the
// client's current name for an issued document.
const LIST_COLUMNS = 'id, type, number, year, status, issue_date, due_date, buyer_name, client:clients(name)'
const DETAIL_COLUMNS =
  'id, type, number, year, status, client_id, issue_date, due_date, notes, buyer_name, buyer_matricule_fiscal, buyer_address'

export type DocumentListItem = {
  id: string
  type: DocumentType
  number: number | null
  year: number | null
  status: DocumentStatus
  issue_date: string | null
  due_date: string | null
  buyer_name: string | null
  client: { name: string } | null
}

export type DocumentDetail = {
  id: string
  type: DocumentType
  number: number | null
  year: number | null
  status: DocumentStatus
  client_id: string | null
  issue_date: string | null
  due_date: string | null
  notes: string | null
  buyer_name: string | null
  buyer_matricule_fiscal: string | null
  buyer_address: string | null
}

export type DocumentFilters = { type: DocumentType | null; status: DocumentStatus | null }

export const documentsKey = (organizationId: string) => ['documents', organizationId] as const

/**
 * Newest first; the id breaks ties so two documents created at the same instant always
 * come in the same order. The filters are values of fixed lists, never free text.
 */
export async function listDocuments(organizationId: string, filters: DocumentFilters): Promise<DocumentListItem[]> {
  let query = supabase.from('documents').select(LIST_COLUMNS).eq('organization_id', organizationId)
  if (filters.type !== null) query = query.eq('type', filters.type)
  if (filters.status !== null) query = query.eq('status', filters.status)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(DOCUMENTS_LIMIT)
  if (error) throw error
  return data
}

/** Returns null when the document does not exist in this organization. */
export async function getDocument(organizationId: string, documentId: string): Promise<DocumentDetail | null> {
  const { data, error } = await supabase
    .from('documents')
    .select(DETAIL_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('id', documentId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Creates a draft and returns its id. The document has no number: only finalizing gives one. */
export async function createDraft(organizationId: string, values: NewDraftValues): Promise<string> {
  const { data, error } = await supabase
    .from('documents')
    .insert(draftInsertPayload(organizationId, values))
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/** Fails with PGRST116 when no row was updated: the document is no longer a draft, or is gone. */
export async function updateDraftHeader(organizationId: string, documentId: string, values: DraftHeaderValues): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update(draftUpdatePayload(values))
    .eq('organization_id', organizationId)
    .eq('id', documentId)
    .select('id')
    .single()
  if (error) throw error
}

/** Fails with PGRST116 when no row was deleted: the document is no longer a draft, or is gone. */
export async function deleteDraft(organizationId: string, documentId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', documentId)
    .select('id')
    .single()
  if (error) throw error
}
