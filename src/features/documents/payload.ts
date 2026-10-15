import { dbNumeric } from '../../lib/dbNumeric'
import { type Millimes, toDbNumeric } from '../../lib/money/money'
import { isIsoDay } from './dates'
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

// --- finalizing -------------------------------------------------------------------------------
// The arguments of the RPC finalize_document(p_document_id, p_expected_net_a_payer).
// The second one is the net à payer the user confirmed, and Postgres issues the document
// only if it computes exactly the same amount (DF009 otherwise).
// It is TEXT with 3 decimals ("1190.600"), built by toDbNumeric() from an integer number
// of millimes: never a JavaScript number, which would be a float and would not even have
// the form Postgres compares with ("1190.6" is refused).

export function finalizePayload(documentId: string, expectedNetAPayer: Millimes) {
  return {
    p_document_id: documentId,
    p_expected_net_a_payer: toDbNumeric(expectedNetAPayer),
  }
}

// --- payments and cancelling ---------------------------------------------------------------
// The API role cannot insert a payment: record_payment(p_document_id, p_amount, p_paid_at,
// p_method) is its only path. The amount is TEXT with 3 decimals ("250.000"), for the same
// reason as the expected total above; Postgres refuses any other form and zero (DF024).
// Whether the amount fits the remaining amount is Postgres's decision (DF018), not ours.
// TODO(accountant): paid_at has no rule yet beyond being a calendar day.

export const PAYMENT_METHODS = ['virement', 'cheque', 'cash'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export function paymentPayload(documentId: string, amount: Millimes, paidAt: string, method: PaymentMethod) {
  if (amount === 0) throw new RangeError('a payment cannot be zero')
  if (!isIsoDay(paidAt)) throw new RangeError('paid_at must be a YYYY-MM-DD day')
  return {
    p_document_id: documentId,
    p_amount: toDbNumeric(amount),
    p_paid_at: paidAt,
    p_method: method,
  }
}

// cancel_devis(p_devis_id): only a sent devis, never once a facture was converted from it (DF021).
export function cancelDevisPayload(devisId: string) {
  return { p_devis_id: devisId }
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
