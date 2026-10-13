import { fromDbNumeric, fromDbQuantity, fromDbRate, type Millimes, type QtyMilli, type RateMilli } from '../../lib/money/money'
import { supabase } from '../../lib/supabase'
import { documentsKey } from './api'
import type { ItemValues } from './itemSchema'
import { itemInsertPayload, itemUpdatePayload } from './payload'

// The lines (table document_items) of one document.
//
// One line = one row = one request: a line is inserted, updated or deleted on its own.
// PostgREST has no transaction across requests, so saving "the whole document" at once
// would either need a database function (a new migration) or a delete-then-insert that
// could stop half way. A single-row write cannot be half done.
//
// Every call names organization_id AND document_id, on top of RLS. The API role may
// insert organization_id, document_id, position, description, quantity, unit_price,
// tva_rate and update the last five; it can never move a line to another document.
//
// The lines of a document that is no longer a draft cannot be written:
//   * UPDATE / DELETE: RLS filters the row out, PostgREST reports no error and no row.
//     Every write therefore ends with .select('id').single(), which fails with PGRST116.
//   * INSERT: the guard trigger answers DF014 (it runs before RLS).

// PostgREST never returns more than max_rows (1000, supabase/config.toml).
export const ITEMS_LIMIT = 1000

// Numeric columns are read as TEXT: a JSON number would be a JavaScript float.
// src/test/sourceRules.test.ts refuses any select of these columns without ::text.
const ITEM_COLUMNS = 'id, position, description, quantity::text, unit_price::text, tva_rate::text'

export type DocumentItem = {
  id: string
  position: number
  description: string
  quantity: QtyMilli
  unitPrice: Millimes
  tvaRate: RateMilli
}

export const itemsKey = (organizationId: string, documentId: string) => [...documentsKey(organizationId), 'items', documentId] as const

/** In the order of the document: position, then creation (two lines may share a position). */
export async function listItems(organizationId: string, documentId: string): Promise<DocumentItem[]> {
  const { data, error } = await supabase
    .from('document_items')
    .select(ITEM_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('document_id', documentId)
    .order('position')
    .order('created_at')
    .order('id')
    .limit(ITEMS_LIMIT)
  if (error) throw error
  return data.map((row) => ({
    id: row.id,
    position: row.position,
    description: row.description,
    quantity: fromDbQuantity(row.quantity),
    unitPrice: fromDbNumeric(row.unit_price),
    tvaRate: fromDbRate(row.tva_rate),
  }))
}

/** Adds a line at `position`. DF014 when the document is no longer a draft. */
export async function createItem(organizationId: string, documentId: string, position: number, values: ItemValues): Promise<void> {
  const { error } = await supabase
    .from('document_items')
    .insert(itemInsertPayload(organizationId, documentId, position, values))
    .select('id')
    .single()
  if (error) throw error
}

/** Fails with PGRST116 when no row was updated: the line is gone, or the document is no longer a draft. */
export async function updateItem(organizationId: string, documentId: string, itemId: string, values: ItemValues): Promise<void> {
  const { error } = await supabase
    .from('document_items')
    .update(itemUpdatePayload(values))
    .eq('organization_id', organizationId)
    .eq('document_id', documentId)
    .eq('id', itemId)
    .select('id')
    .single()
  if (error) throw error
}

/** Fails with PGRST116 when no row was deleted: the line is gone, or the document is no longer a draft. */
export async function deleteItem(organizationId: string, documentId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from('document_items')
    .delete()
    .eq('organization_id', organizationId)
    .eq('document_id', documentId)
    .eq('id', itemId)
    .select('id')
    .single()
  if (error) throw error
}
