import { useId, useState } from 'react'
import { type Control, type FieldPathByValue, type FieldValues, useController } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { type DecimalKind, understand } from './decimalText'

type DecimalFieldProps<Values extends FieldValues, Output> = {
  /** `Output` is what the form's schema produces; this field only deals with the text. */
  control: Control<Values, unknown, Output>
  /** A field of the form whose value is the text typed by the user. */
  name: FieldPathByValue<Values, string>
  /** 'amount': shown as "= 1 500,000 TND". 'rate': a percentage, "= 19 %". 'quantity': "= 1,5". */
  kind: DecimalKind
  label: string
  hint?: string
  /** i18n key coming from the form's Zod schema (for example "required"). */
  errorKey?: string | undefined
}

/**
 * The ONE input for amounts and rates. The form keeps the text exactly as typed; the
 * money module reads it. Once the user leaves the field it shows, under it, the value as
 * it was understood ("= 1 500,000 TND"), or a French error when it cannot be read.
 * Reason: "1.500" and "1,500" are both read as one and a half, and "1 500" is refused.
 *
 * It is a text input on purpose (not type="number"): a number input accepts "1e3", drops
 * what it cannot read without telling, and changes the decimal separator with the browser.
 */
export function DecimalField<Values extends FieldValues, Output = Values>({
  control,
  name,
  kind,
  label,
  hint,
  errorKey,
}: DecimalFieldProps<Values, Output>) {
  const { t } = useTranslation()
  const {
    field: { value, onChange, onBlur, ref, name: fieldName },
  } = useController({ control, name })
  const [focused, setFocused] = useState(false)
  const id = useId()
  const hintId = `${id}-hint`
  const feedbackId = `${id}-feedback`

  const text: string = value
  // While the user is typing nothing is judged: the reading appears when they leave.
  const understood = focused ? { state: 'empty' as const } : understand(kind, text)
  // The form's own message (a required field, ...) wins over the reading of the text.
  const shownError = errorKey ?? (understood.state === 'invalid' ? understood.errorKey : undefined)
  const shownReading = shownError === undefined && understood.state === 'valid' ? t(understood.key, { value: understood.value }) : undefined
  const describedBy = [hint ? hintId : null, shownError || shownReading ? feedbackId : null].filter(Boolean).join(' ')

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        name={fieldName}
        ref={ref}
        value={text}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          onBlur()
        }}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 aria-invalid:border-red-600"
      />
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-slate-500">
          {hint}
        </p>
      )}
      {shownError && (
        <p id={feedbackId} role="alert" className="mt-1 text-sm text-red-700">
          {t(shownError)}
        </p>
      )}
      {shownReading && (
        <p id={feedbackId} role="status" className="mt-1 text-sm font-medium text-slate-900">
          {shownReading}
        </p>
      )}
    </div>
  )
}
