import { z } from 'zod'
import { type Millimes, parseMillimes } from '../../lib/money/money'
import { isIsoDay } from './dates'
import { PAYMENT_METHODS, type PaymentMethod } from './payload'

// Error messages are i18n keys; the form field translates them.

/** What the fields of the payment form hold: text, exactly as typed. */
export type PaymentInput = { amount: string; paid_at: string; method: string }

/** A payment as the payload takes it. */
export type PaymentValues = { amount: Millimes; paidAt: string; method: PaymentMethod }

const isMethod = (text: string): text is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(text)

/**
 * Reads the payment form with the money module. `remaining` is what the screen believes
 * is still owed: an amount above it is refused here as a convenience, but Postgres is the
 * one that decides (DF018), with the payments it has.
 * TODO(accountant): paid_at has no rule yet beyond being a calendar day (decision E-6).
 */
export function readPayment(input: PaymentInput, remaining: Millimes): { ok: true; values: PaymentValues } | { ok: false; errors: Partial<Record<keyof PaymentInput, string>> } {
  const errors: Partial<Record<keyof PaymentInput, string>> = {}

  const amount = parseMillimes(input.amount)
  if (input.amount.trim() === '') errors.amount = 'documents.payments.validation.amountRequired'
  else if (amount === null) errors.amount = 'validation.amountInvalid'
  else if (amount === 0) errors.amount = 'documents.payments.validation.amountPositive'
  else if (amount > remaining) errors.amount = 'documents.payments.validation.overRemaining'

  if (input.paid_at === '') errors.paid_at = 'documents.payments.validation.dateRequired'
  else if (!isIsoDay(input.paid_at)) errors.paid_at = 'documents.payments.validation.dateInvalid'

  if (!isMethod(input.method)) errors.method = 'documents.payments.validation.methodRequired'

  if (amount === null || !isMethod(input.method) || Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, values: { amount, paidAt: input.paid_at, method: input.method } }
}

/** The same rules as a Zod schema, for React Hook Form: text in, PaymentValues out. */
export const paymentSchema = (remaining: Millimes) =>
  z
    .object({ amount: z.string(), paid_at: z.string(), method: z.string() })
    .transform((input, context): PaymentValues => {
      const read = readPayment(input, remaining)
      if (read.ok) return read.values
      for (const [field, message] of Object.entries(read.errors)) context.addIssue({ code: 'custom', path: [field], message })
      return z.NEVER
    })
