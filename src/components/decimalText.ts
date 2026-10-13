import { formatMillimes, formatRate, parseMillimes, parseRate } from '../lib/money/money'

export type DecimalKind = 'amount' | 'rate'

export type Understood =
  | { state: 'empty' }
  | { state: 'invalid'; errorKey: string }
  /** `key` is an i18n key that takes `value`, the number as the application read it. */
  | { state: 'valid'; key: string; value: string }

/**
 * How the application reads what was typed in an amount or a rate field.
 * "1.500" and "1,500" are both one and a half: the user must see that, not guess it.
 */
export function understand(kind: DecimalKind, text: string): Understood {
  if (text.trim() === '') return { state: 'empty' }
  if (kind === 'amount') {
    const amount = parseMillimes(text)
    return amount === null
      ? { state: 'invalid', errorKey: 'validation.amountInvalid' }
      : { state: 'valid', key: 'money.understoodAmount', value: formatMillimes(amount) }
  }
  const rate = parseRate(text)
  return rate === null
    ? { state: 'invalid', errorKey: 'validation.rateInvalid' }
    : { state: 'valid', key: 'money.understoodRate', value: formatRate(rate) }
}
