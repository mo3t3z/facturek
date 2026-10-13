import { z } from 'zod'
import { type Millimes, parseMillimes, parseQuantity, parseRate, type QtyMilli, type RateMilli } from '../../lib/money/money'

// Error messages are i18n keys; the form field translates them.

/** A line as the calculations and the database payloads take it: integers, never text. */
export type ItemValues = {
  description: string
  quantity: QtyMilli
  unitPrice: Millimes
  tvaRate: RateMilli
}

/** What the fields of the line form hold: text, exactly as typed. */
export type ItemInput = { description: string; quantity: string; unit_price: string; tva_rate: string }

// The table has no length limit on the description (only "not blank"). This one keeps a
// printed line readable; it is a screen rule, not a security rule.
export const DESCRIPTION_MAX_LENGTH = 500

/**
 * Reads the text of the line form with the money module, and nothing else.
 * Returns the line, or the i18n key of the first problem of each field.
 * It is the single definition of "a complete line": the form uses it to validate, and
 * the totals preview uses it to decide whether the line being typed can be counted.
 */
export function readItem(input: ItemInput): { ok: true; values: ItemValues } | { ok: false; errors: Partial<Record<keyof ItemInput, string>> } {
  const errors: Partial<Record<keyof ItemInput, string>> = {}
  const description = input.description.trim()
  if (description === '') errors.description = 'documents.items.validation.descriptionRequired'
  else if (description.length > DESCRIPTION_MAX_LENGTH) errors.description = 'validation.tooLong'

  const quantity = parseQuantity(input.quantity)
  if (input.quantity.trim() === '') errors.quantity = 'documents.items.validation.quantityRequired'
  else if (quantity === null) errors.quantity = 'validation.quantityInvalid'
  // Same rule as the CHECK (quantity > 0) of the table.
  else if (quantity === 0) errors.quantity = 'documents.items.validation.quantityPositive'

  const unitPrice = parseMillimes(input.unit_price)
  if (input.unit_price.trim() === '') errors.unit_price = 'documents.items.validation.unitPriceRequired'
  else if (unitPrice === null) errors.unit_price = 'validation.amountInvalid'

  // No silent default: an empty rate is an error, zero must be typed.
  const tvaRate = parseRate(input.tva_rate)
  if (input.tva_rate.trim() === '') errors.tva_rate = 'documents.items.validation.tvaRateRequired'
  else if (tvaRate === null) errors.tva_rate = 'validation.rateInvalid'

  if (quantity === null || unitPrice === null || tvaRate === null || Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, values: { description, quantity, unitPrice, tvaRate } }
}

/** The same rules as a Zod schema, for React Hook Form: text in, ItemValues out. */
export const itemSchema = z
  .object({ description: z.string(), quantity: z.string(), unit_price: z.string(), tva_rate: z.string() })
  .transform((input, context): ItemValues => {
    const read = readItem(input)
    if (read.ok) return read.values
    for (const [field, message] of Object.entries(read.errors)) context.addIssue({ code: 'custom', path: [field], message })
    return z.NEVER
  })
