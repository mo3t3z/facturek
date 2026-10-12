import { z } from 'zod'

// Error messages are i18n keys; the form field translates them.

// Keep in sync with minimum_password_length in supabase/config.toml. The server enforces
// it; this copy only gives the user an immediate message.
export const PASSWORD_MIN_LENGTH = 10
// bcrypt, used by Supabase Auth, ignores everything after 72 bytes.
const PASSWORD_MAX_LENGTH = 72

const email = z.string().trim().min(1, 'auth.validation.required').pipe(z.email('auth.validation.emailInvalid'))

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'auth.validation.passwordTooShort')
  .max(PASSWORD_MAX_LENGTH, 'auth.validation.passwordTooLong')

export const loginSchema = z.object({
  email,
  // No length rule at login: the rule may have changed since the account was created.
  password: z.string().min(1, 'auth.validation.required'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const signupSchema = z
  .object({
    // Same limit as the database (private.provision_account truncates at 100).
    fullName: z.string().trim().min(1, 'auth.validation.required').max(100, 'auth.validation.tooLong'),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.validation.passwordMismatch',
  })
export type SignupValues = z.infer<typeof signupSchema>

export const forgotPasswordSchema = z.object({ email })
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.validation.passwordMismatch',
  })
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>
