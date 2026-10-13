import type { DocumentStatus, DocumentType } from './schemas'

/**
 * The number of an issued document as shown to the user: year, a dash, the number on at
 * least 4 digits ("2026-0001"). A draft has no number: null.
 * TODO(accountant): confirm this format (and whether the type must appear in it) before
 * real use. The numbers themselves are assigned by finalize_document(), never here.
 */
export function formatDocumentNumber(year: number | null, number: number | null): string | null {
  if (year === null || number === null) return null
  return `${year}-${String(number).padStart(4, '0')}`
}

/** i18n key of a status label. It depends on the type: "facture" is feminine in French. */
export const statusKey = (type: DocumentType, status: DocumentStatus) => `documents.status.${type}.${status}`
export const typeKey = (type: DocumentType) => `documents.type.${type}`

// PGRST116 = "no row": the UPDATE or DELETE matched nothing. RLS only lets a draft be
// changed, so the document was issued in the meantime, or it no longer exists.
// 23503 on a document can only be its client: it was deleted while the form was open.
export const DOCUMENT_WRITE_ERRORS = {
  PGRST116: 'documents.errors.notDraftOrMissing',
  '23503': 'documents.errors.clientMissing',
}

// A line write that matched no row (PGRST116): the line was removed elsewhere, or the
// document was issued in the meantime and RLS no longer lets its lines be changed.
// (An INSERT into an issued document answers DF014, which has its own message.)
export const ITEM_WRITE_ERRORS = { PGRST116: 'documents.items.errors.notEditable' }
