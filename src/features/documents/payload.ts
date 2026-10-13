import { dbNumeric } from '../../lib/dbNumeric'
import type { ItemValues } from './itemSchema'
import type { DraftHeaderValues, NewDraftValues } from './schemas'

// What the frontend is allowed to write on a document, and nothing else.
//
// The API role may INSERT only organization_id, type, client_id, issue_date, due_date,
// notes (and converted_from, used later by the conversion), and UPDATE only client_id,
// issue_date, due_date, notes. status, number, year and the snapshot columns are written
// by finalize_document() in Postgres. Sending one of them would be refused (42501); the
// payloads are built here, in one place, so a test can check their exact keys.

/** An empty date or note is stored as NULL. */
const orNull = (text: string) => (text === '' ? null : text)

export function draftInsertPayload(organizationId: string, values: NewDraftValues) {
  return {
    organization_id: organizationId,
    type: values.type,
    client_id: values.client_id,
    issue_date: orNull(values.issue_date),
    due_date: orNull(values.due_date),
    notes: orNull(values.notes),
  }
}

export function draftUpdatePayload(values: DraftHeaderValues) {
  return {
    client_id: values.client_id,
    issue_date: orNull(values.issue_date),
    due_date: orNull(values.due_date),
    notes: orNull(values.notes),
  }
}

// --- lines ------------------------------------------------------------------------------------
// The API role may INSERT organization_id, document_id, position, description, quantity,
// unit_price, tva_rate, and UPDATE position, description, quantity, unit_price, tva_rate.
// Numerics are sent as text through dbNumeric(), never as JavaScript numbers.
// Nothing computed (a line total, a TVA amount) is ever sent: the database has no such column.

export function itemInsertPayload(organizationId: string, documentId: string, position: number, values: ItemValues) {
  return {
    organization_id: organizationId,
    document_id: documentId,
    position,
    ...itemUpdatePayload(values),
  }
}

/** The position is not part of an edit: a line stays where it is. */
export function itemUpdatePayload(values: ItemValues) {
  return {
    description: values.description,
    quantity: dbNumeric(values.quantity),
    unit_price: dbNumeric(values.unitPrice),
    tva_rate: dbNumeric(values.tvaRate),
  }
}
