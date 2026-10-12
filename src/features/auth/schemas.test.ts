import { describe, expect, it } from 'vitest'
import { forgotPasswordSchema, loginSchema, PASSWORD_MIN_LENGTH, resetPasswordSchema, signupSchema } from './schemas'

const validSignup = {
  fullName: 'Amel Ben Salah',
  email: 'amel@example.tn',
  password: 'correct-horse-battery',
  confirmPassword: 'correct-horse-battery',
}
const firstIssue = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) => result.error?.issues[0]

describe('signupSchema', () => {
  it('accepts a valid signup and trims the name and the email', () => {
    const result = signupSchema.safeParse({ ...validSignup, fullName: '  Amel  ', email: ' amel@example.tn ' })
    expect(result.success).toBe(true)
    expect(result.data?.fullName).toBe('Amel')
    expect(result.data?.email).toBe('amel@example.tn')
  })

  it('requires the same minimum password length as the server (10)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10)
    const nine = 'a'.repeat(9)
    const result = signupSchema.safeParse({ ...validSignup, password: nine, confirmPassword: nine })
    expect(firstIssue(result)?.message).toBe('auth.validation.passwordTooShort')
    const ten = 'a'.repeat(10)
    expect(signupSchema.safeParse({ ...validSignup, password: ten, confirmPassword: ten }).success).toBe(true)
  })

  it('rejects a password longer than 72 characters', () => {
    const long = 'a'.repeat(73)
    const result = signupSchema.safeParse({ ...validSignup, password: long, confirmPassword: long })
    expect(firstIssue(result)?.message).toBe('auth.validation.passwordTooLong')
  })

  it('reports a mismatch on the confirmation field', () => {
    const result = signupSchema.safeParse({ ...validSignup, confirmPassword: 'something-else-entirely' })
    expect(firstIssue(result)?.path).toEqual(['confirmPassword'])
    expect(firstIssue(result)?.message).toBe('auth.validation.passwordMismatch')
  })

  it('rejects a blank name and a name over 100 characters', () => {
    expect(firstIssue(signupSchema.safeParse({ ...validSignup, fullName: '   ' }))?.message).toBe('auth.validation.required')
    expect(firstIssue(signupSchema.safeParse({ ...validSignup, fullName: 'x'.repeat(101) }))?.message).toBe('auth.validation.tooLong')
    expect(signupSchema.safeParse({ ...validSignup, fullName: 'x'.repeat(100) }).success).toBe(true)
  })

  it.each(['', 'not-an-email', 'a@', '@b.tn', 'a b@c.tn'])('rejects the email %j', (email) => {
    expect(signupSchema.safeParse({ ...validSignup, email }).success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('accepts any non-empty password (no length rule at login)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.tn', password: 'x' }).success).toBe(true)
  })

  it('requires both fields with i18n keys as messages', () => {
    expect(firstIssue(loginSchema.safeParse({ email: '', password: 'x' }))?.message).toBe('auth.validation.required')
    expect(firstIssue(loginSchema.safeParse({ email: 'nope', password: 'x' }))?.message).toBe('auth.validation.emailInvalid')
    expect(firstIssue(loginSchema.safeParse({ email: 'a@b.tn', password: '' }))?.message).toBe('auth.validation.required')
  })
})

describe('forgotPasswordSchema and resetPasswordSchema', () => {
  it('validates the email of a reset request', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.tn' }).success).toBe(true)
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })

  it('applies the password rules to a new password', () => {
    const ok = 'a-long-enough-password'
    expect(resetPasswordSchema.safeParse({ password: ok, confirmPassword: ok }).success).toBe(true)
    expect(resetPasswordSchema.safeParse({ password: 'short', confirmPassword: 'short' }).success).toBe(false)
    expect(resetPasswordSchema.safeParse({ password: ok, confirmPassword: `${ok}!` }).success).toBe(false)
  })
})
