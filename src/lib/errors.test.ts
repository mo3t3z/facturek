import { AuthApiError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import fr from '../locales/fr/translation.json'
import { errorMessageKey, LOGIN_FAILED_KEY, NETWORK_ERROR_KEY, UNKNOWN_ERROR_KEY } from './errors'

/** Resolves "a.b.c" in the French translation file. */
function translation(key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined),
    fr,
  )
}

const dbError = (code: string, message = 'internal') => ({ code, message, details: null, hint: null })

describe('errorMessageKey', () => {
  it.each(['DF000', 'DF001', 'DF002', 'DF003', 'DF004', 'DF005', 'DF006', 'DF007', 'DF008', 'DF010', 'DF011',
    'DF012', 'DF013', 'DF014', 'DF015', 'DF016', 'DF017', 'DF020', 'DF040'])(
    'maps the database code %s to its own French message',
    (code) => {
      const key = errorMessageKey(dbError(code))
      expect(key).toBe(`errors.db.${code}`)
      expect(typeof translation(key)).toBe('string')
    },
  )

  it('gives DF014 and DF016 distinct, specific messages', () => {
    expect(translation('errors.db.DF014')).not.toBe(translation('errors.db.DF016'))
    expect(translation('errors.db.DF014')).not.toBe(translation(UNKNOWN_ERROR_KEY))
    expect(translation('errors.db.DF016')).not.toBe(translation(UNKNOWN_ERROR_KEY))
  })

  it.each(['42501', '23503', '23505', '23514'])('maps the standard SQLSTATE %s', (code) => {
    const key = errorMessageKey(dbError(code))
    expect(key).toBe(`errors.db.${code}`)
    expect(typeof translation(key)).toBe('string')
  })

  it.each(['invalid_credentials', 'email_not_confirmed', 'user_not_found', 'user_banned'])(
    'maps the login failure %s to the single generic login message',
    (code) => {
      expect(errorMessageKey(new AuthApiError('whatever', 400, code))).toBe(LOGIN_FAILED_KEY)
    },
  )

  it.each(['weak_password', 'same_password', 'over_request_rate_limit', 'over_email_send_rate_limit', 'otp_expired'])(
    'maps the auth code %s to its own French message',
    (code) => {
      const key = errorMessageKey(new AuthApiError('whatever', 400, code))
      expect(key).toBe(`errors.auth.${code}`)
      expect(typeof translation(key)).toBe('string')
    },
  )

  it('maps a failed network request', () => {
    expect(errorMessageKey(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_KEY)
    expect(errorMessageKey({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe(NETWORK_ERROR_KEY)
  })

  it.each([
    dbError('XX000', 'relation "public.secret_table" does not exist'),
    dbError('42P01', 'select * from auth.users'),
    new AuthApiError('unexpected', 500, 'unexpected_failure'),
    new Error('boom'),
    { message: 'no code at all' },
    'a string',
    null,
    undefined,
    42,
  ])('falls back to the generic key for the unknown error %#', (error) => {
    expect(errorMessageKey(error)).toBe(UNKNOWN_ERROR_KEY)
  })

  it('never returns the raw message, whatever it contains', () => {
    const sql = 'insert or update on table "payments" violates foreign key constraint "payments_document_fk"'
    for (const error of [dbError('23503', sql), dbError('XX000', sql), new Error(sql)]) {
      const key = errorMessageKey(error)
      expect(key).toMatch(/^errors\./)
      expect(String(translation(key))).not.toContain('payments_document_fk')
    }
  })

  describe('specific keys given by a screen', () => {
    const specific = { '23503': 'clients.errors.inUse' }

    it('uses the screen key for that code, and it has its own French text', () => {
      const key = errorMessageKey(dbError('23503'), specific)
      expect(key).toBe('clients.errors.inUse')
      expect(typeof translation(key)).toBe('string')
      expect(translation(key)).not.toBe(translation('errors.db.23503'))
      expect(translation(key)).not.toBe(translation(UNKNOWN_ERROR_KEY))
    })

    it('keeps the generic 23503 message for a screen that gives nothing', () => {
      expect(errorMessageKey(dbError('23503'))).toBe('errors.db.23503')
    })

    it('leaves every other code alone', () => {
      expect(errorMessageKey(dbError('42501'), specific)).toBe('errors.db.42501')
      expect(errorMessageKey(dbError('XX000'), specific)).toBe(UNKNOWN_ERROR_KEY)
      expect(errorMessageKey(new TypeError('Failed to fetch'), specific)).toBe(NETWORK_ERROR_KEY)
      expect(errorMessageKey({ message: 'no code' }, specific)).toBe(UNKNOWN_ERROR_KEY)
    })

    it('is not fooled by a code named like an Object.prototype member', () => {
      expect(errorMessageKey(dbError('toString'), specific)).toBe(UNKNOWN_ERROR_KEY)
      expect(errorMessageKey(dbError('constructor'), specific)).toBe(UNKNOWN_ERROR_KEY)
    })
  })

  it('has a French text for the generic, network and login keys', () => {
    for (const key of [UNKNOWN_ERROR_KEY, NETWORK_ERROR_KEY, LOGIN_FAILED_KEY]) {
      expect(typeof translation(key)).toBe('string')
    }
  })
})
