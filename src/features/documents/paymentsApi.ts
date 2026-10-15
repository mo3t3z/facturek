import { fromDbNumeric, type Millimes } from '../../lib/money/money'
import { supabase } from '../../lib/supabase'
import { documentsKey } from './api'
import { cancelDevisPayload, type PaymentMethod, paymentPayload } from './payload'

// The payments of a facture, recording one, and cancelling a devis.
//
// Recording and cancelling go through two functions of Postgres, record_payment() and
// cancel_devis(): the API role has no INSERT on payments and cannot write a status. Postgres
// decides everything: overpayment (DF018), 'paid' when the payments cover the net à payer,
// no cancel once a facture was converted from the devis (DF021).
//
// Like finalizeDocument(), each call first checks that the document belongs to the
// organization of the screen (PGRST116 otherwise), on top of RLS.
// Nothing returned by the functions is used as an amount: an RPC returns its numerics as
// JSON numbers. The screen reloads the payments, read as text, instead.

// PostgREST never returns more than max_rows (1000); a facture with more payments than
// that would be read truncated. Far beyond any real case: not handled.
export const PAYMENTS_LIMIT = 1000

// Read as TEXT: a JSON number would be a JavaScript float.
const PAYMENT_COLUMNS = 'id, amount::text, paid_at, method'

export type Payment = {
  id: string
  amount: Millimes
  /** A calendar day, YYYY-MM-DD, as stored. */
  paidAt: string
  method: PaymentMethod
}

export const paymentsKey = (organizationId: string, documentId: string) => [...documentsKey(organizationId), 'payments', documentId] as const

/** In the order they were paid, then recorded. */
export async function listPayments(organizationId: string, documentId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('document_id', documentId)
    .order('paid_at')
    .order('created_at')
    .order('id')
    .limit(PAYMENTS_LIMIT)
  if (error) throw error
  return data.map((row) => ({ id: row.id, amount: fromDbNumeric(row.amount), paidAt: row.paid_at, method: row.method }))
}

async function assertInOrganization(organizationId: string, documentId: string): Promise<void> {
  const found = await supabase.from('documents').select('id').eq('organization_id', organizationId).eq('id', documentId).single()
  if (found.error) throw found.error
}

/** Returns only the id of the new payment. */
export async function recordPayment(
  organizationId: string,
  documentId: string,
  amount: Millimes,
  paidAt: string,
  method: PaymentMethod,
): Promise<{ id: string }> {
  const payload = paymentPayload(documentId, amount, paidAt, method)
  await assertInOrganization(organizationId, documentId)
  const { data, error } = await supabase.rpc('record_payment', payload)
  if (error) throw error
  return { id: data.id }
}

export async function cancelDevis(organizationId: string, devisId: string): Promise<{ id: string; status: string }> {
  await assertInOrganization(organizationId, devisId)
  const { data, error } = await supabase.rpc('cancel_devis', cancelDevisPayload(devisId))
  if (error) throw error
  return { id: data.id, status: data.status }
}
