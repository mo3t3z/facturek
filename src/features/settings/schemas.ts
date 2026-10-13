import { z } from 'zod'
import { parseMillimes, parseRate } from '../../lib/money/money'

// Error messages are i18n keys; the form field translates them.

const optionalText = (max: number) => z.string().trim().max(max, 'validation.tooLong')

// Same shape as a client: the organization is the seller printed on the documents.
// The matricule fiscal is free text: its format is not validated in this phase.
export const organizationSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  matricule_fiscal: optionalText(50),
  address: optionalText(500),
  email: optionalText(254).refine(
    (value) => value === '' || z.email().safeParse(value).success,
    'validation.emailInvalid',
  ),
  phone: optionalText(30),
})
export type OrganizationValues = z.infer<typeof organizationSchema>

// The form holds the TEXT typed by the user; the money module reads it. Empty means
// "not set" and is stored as NULL: no rate and no amount is ever assumed.
export const taxSettingsSchema = z
  .object({
    default_tva_rate: z
      .string()
      .refine((text) => text.trim() === '' || parseRate(text) !== null, 'validation.rateInvalid'),
    timbre_enabled: z.boolean(),
    timbre_fiscal: z
      .string()
      .refine((text) => text.trim() === '' || parseMillimes(text) !== null, 'validation.amountInvalid'),
  })
  // The database refuses to issue a facture when the timbre is applied without an amount
  // (DF007). The form asks for it right away instead.
  .refine((values) => !values.timbre_enabled || values.timbre_fiscal.trim() !== '', {
    path: ['timbre_fiscal'],
    message: 'settings.tax.timbreRequired',
  })
export type TaxSettingsValues = z.infer<typeof taxSettingsSchema>
