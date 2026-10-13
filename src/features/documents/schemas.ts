import { z } from 'zod'
import { isBeforeDay, isIsoDay } from './dates'

// Error messages are i18n keys; the form field translates them.

export const DOCUMENT_TYPES = ['devis', 'facture'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export const DOCUMENT_STATUSES = ['draft', 'sent', 'paid', 'cancelled'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const isDocumentType = (value: unknown): value is DocumentType => DOCUMENT_TYPES.some((type) => type === value)
export const isDocumentStatus = (value: unknown): value is DocumentStatus => DOCUMENT_STATUSES.some((status) => status === value)

export const documentIdSchema = z.uuid()

// A date field holds "" (no date) or the "YYYY-MM-DD" text of an <input type="date">.
const optionalDay = z.string().refine((text) => text === '' || isIsoDay(text), 'documents.validation.dateInvalid')

// The form holds text everywhere (a <select> and an <input type="date"> give strings); the
// schema turns it into the values sent to the database.
export const newDraftSchema = z
  .object({
    type: z.string().pipe(z.enum(DOCUMENT_TYPES, 'documents.validation.typeRequired')),
    // The database allows a draft without a client, but it could never be issued (DF003).
    // The form asks for it from the start.
    client_id: z.string().pipe(z.uuid('documents.validation.clientRequired')),
    issue_date: optionalDay,
    due_date: optionalDay,
    notes: z.string().trim().max(2000, 'validation.tooLong'),
  })
  // Same rule as the CHECK documents_due_after_issue: the form says it before the database does.
  .refine(
    (values) => !(isIsoDay(values.issue_date) && isIsoDay(values.due_date) && isBeforeDay(values.due_date, values.issue_date)),
    { path: ['due_date'], message: 'documents.validation.dueBeforeIssue' },
  )
/** What the form fields hold: text. */
export type NewDraftInput = z.input<typeof newDraftSchema>
/** A new draft: its type and its header. */
export type NewDraftValues = z.infer<typeof newDraftSchema>
/** The header of an existing draft: its type can no longer change. */
export type DraftHeaderValues = Omit<NewDraftValues, 'type'>
