import { fromDbNumeric, type Millimes } from '../../lib/money/money'
import { supabase } from '../../lib/supabase'
import { draftInsertPayload, draftUpdatePayload, finalizePayload } from './payload'
import type { DocumentStatus, DocumentType, DraftHeaderValues, NewDraftValues } from './schemas'

// Documents (devis and factures) of the current organization: the list and the header of
// a draft. Items, totals and finalizing come in later checkpoints.
//
// Every call names the organization explicitly, on top of RLS (see clients/api.ts).
// Columns are always listed: select('*') would return the numeric columns as JSON numbers.
// Every amount is selected as TEXT (::text) and parsed with fromDbNumeric; `number` and
// `year` are integers. src/test/sourceRules.test.ts refuses an amount without ::text.
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
// net_a_payer is NULL on a draft: a draft stores no total.
const LIST_COLUMNS = 'id, type, number, year, status, issue_date, due_date, buyer_name, net_a_payer::text, client:clients(name)'
// The seller and buyer columns and the totals are the snapshot taken when the document was
// issued; they are all NULL on a draft. tva_breakdown is jsonb whose values are strings.
// One literal on purpose: supabase-js reads the columns from the TYPE of this string.
const DETAIL_COLUMNS =
  'id, type, number, year, status, client_id, issue_date, due_date, notes, seller_name, seller_matricule_fiscal, seller_address, buyer_name, buyer_matricule_fiscal, buyer_address, total_ht::text, total_tva::text, total_ttc::text, timbre_fiscal::text, net_a_payer::text, tva_breakdown'

export type DocumentListItem = {
  id: string
  type: DocumentType
  number: number | null
  year: number | null
  status: DocumentStatus
  issue_date: string | null
  due_date: string | null
  buyer_name: string | null
  /** The stored net à payer of an issued document; null for a draft. */
  netAPayer: Millimes | null
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
  seller_name: string | null
  seller_matricule_fiscal: string | null
  seller_address: string | null
  buyer_name: string | null
  buyer_matricule_fiscal: string | null
  buyer_address: string | null
  // The stored totals, exactly as PostgREST returns them: text with 3 decimals, or null on
  // a draft. They are read by readStoredTotals() (storedTotals.ts), nowhere else.
  total_ht: string | null
  total_tva: string | null
  total_ttc: string | null
  timbre_fiscal: string | null
  net_a_payer: string | null
  tva_breakdown: unknown
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
  return data.map(({ net_a_payer, ...row }) => ({ ...row, netAPayer: net_a_payer === null ? null : fromDbNumeric(net_a_payer) }))
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

export type IssuedDocument = { id: string; number: number; year: number }

/**
 * Issues a draft: Postgres gives it its number, snapshots and totals, and freezes it.
 *
 * `expectedNetAPayer` is the net à payer the user saw and confirmed. Postgres recomputes
 * the totals from the stored lines and issues nothing unless it finds exactly that amount:
 * DF009 means the document changed since the screen computed it (reload and check again).
 * Other refusals: DF001 to DF008, DF022 (total of zero), DF023 (total too large).
 *
 * Only id, number and year are read from the returned row: a uuid and two integers. Its
 * amounts are never read here, because an RPC returns numerics as JSON numbers; the
 * issued view will select them as text.
 *
 * The function checks by itself that the caller belongs to the document's organization,
 * but it takes no organization: the first request is the usual explicit filter of this
 * file. It fails with PGRST116, BEFORE anything is issued, when the document is not in
 * the organization the screen is showing. (The API role cannot change the organization
 * of a document, so the answer cannot become false between the two requests.)
 */
export async function finalizeDocument(organizationId: string, documentId: string, expectedNetAPayer: Millimes): Promise<IssuedDocument> {
  const found = await supabase.from('documents').select('id').eq('organization_id', organizationId).eq('id', documentId).single()
  if (found.error) throw found.error

  const { data, error } = await supabase.rpc('finalize_document', finalizePayload(documentId, expectedNetAPayer))
  if (error) throw error
  if (data.number === null || data.year === null) throw new Error('finalize_document returned a document without a number')
  return { id: data.id, number: data.number, year: data.year }
}
