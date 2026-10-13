import { z } from 'zod'

// Error messages are i18n keys; the form field translates them.
// The database only requires a non-empty name. The length limits here keep the screens
// readable; they are a UX rule, not a security rule.
// The matricule fiscal is free text on purpose: its format is not validated in this phase.

const optionalText = (max: number) => z.string().trim().max(max, 'validation.tooLong')

export const clientSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong'),
  matricule_fiscal: optionalText(50),
  address: optionalText(500),
  email: optionalText(254).refine(
    (value) => value === '' || z.email().safeParse(value).success,
    'validation.emailInvalid',
  ),
  phone: optionalText(30),
})
export type ClientValues = z.infer<typeof clientSchema>

export const clientIdSchema = z.uuid()
