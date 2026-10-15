import { type ComponentProps, type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

type TextFieldProps = ComponentProps<'input'> & {
  label: string
  hint?: string
  /** i18n key coming from the Zod schema. */
  errorKey?: string | undefined
}

/** A labelled input whose hint and error are announced with the field (aria-describedby). */
export function TextField({ label, hint, errorKey, ...inputProps }: TextFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, errorKey ? errorId : null].filter(Boolean).join(' ')
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={errorKey ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="block w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 aria-invalid:border-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-slate-500">
          {hint}
        </p>
      )}
      {errorKey && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}

type SelectFieldProps = ComponentProps<'select'> & {
  label: string
  hint?: string
  /** i18n key coming from the Zod schema. */
  errorKey?: string | undefined
}

/** A labelled <select>; its options are given as children. Same announcements as TextField. */
export function SelectField({ label, hint, errorKey, children, ...fieldProps }: SelectFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, errorKey ? errorId : null].filter(Boolean).join(' ')
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={errorKey ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 aria-invalid:border-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        {...fieldProps}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-slate-500">
          {hint}
        </p>
      )}
      {errorKey && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}

type TextAreaFieldProps = ComponentProps<'textarea'> & {
  label: string
  hint?: string
  /** i18n key coming from the Zod schema. */
  errorKey?: string | undefined
}

/** A labelled multi-line text. Same announcements as TextField. */
export function TextAreaField({ label, hint, errorKey, ...fieldProps }: TextAreaFieldProps) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, errorKey ? errorId : null].filter(Boolean).join(' ')
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        aria-invalid={errorKey ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600 aria-invalid:border-red-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        {...fieldProps}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-slate-500">
          {hint}
        </p>
      )}
      {errorKey && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}

type CheckboxFieldProps = Omit<ComponentProps<'input'>, 'type'> & { label: string }

/** A checkbox with its label on the same line; the whole line is the touch target. */
export function CheckboxField({ label, ...inputProps }: CheckboxFieldProps) {
  const id = useId()
  return (
    <div className="mb-4 flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        {...inputProps}
      />
      <label htmlFor={id} className="text-base text-slate-900">
        {label}
      </label>
    </div>
  )
}

export function SubmitButton({ label, pendingLabel, pending }: { label: string; pendingLabel: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-blue-700 px-4 py-2.5 text-base font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const colors =
    kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-900'
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-md border px-3 py-2 text-sm ${colors}`}>
      {children}
    </p>
  )
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded text-sm text-blue-800 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-600"
    >
      {children}
    </Link>
  )
}
