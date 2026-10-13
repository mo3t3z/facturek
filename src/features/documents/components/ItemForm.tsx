import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalField } from '../../../components/DecimalField'
import { Alert, SubmitButton, TextAreaField } from '../../../components/FormControls'
import { secondaryButton } from '../../../components/styles'
import { DESCRIPTION_MAX_LENGTH, type ItemInput, itemSchema, type ItemValues } from '../itemSchema'

type ItemFormProps = {
  title: string
  defaultValues: ItemInput
  /** Hint under the TVA rate: it says whether a default rate was proposed. */
  tvaRateHint: string
  onSubmit: (values: ItemValues) => void
  /** Called with the text of the form each time it changes, so the totals preview can follow. */
  onChange: (input: ItemInput) => void
  /** Present when the form can be closed without saving (editing an existing line). */
  onCancel?: () => void
  pending: boolean
  /** i18n key of the error returned by the last save, if any. */
  errorKey: string | null
  submitLabel: string
  pendingLabel: string
}

/**
 * The form of ONE line. It keeps the text exactly as typed; itemSchema reads it with the
 * money module (parseQuantity, parseMillimes, parseRate). The three number fields are
 * DecimalField: once left, each shows the value as it was understood.
 */
export function ItemForm(props: ItemFormProps) {
  const { t } = useTranslation()
  const form = useForm<ItemInput, unknown, ItemValues>({ resolver: zodResolver(itemSchema), defaultValues: props.defaultValues })
  const errors = form.formState.errors
  const { onChange } = props

  // The parent follows what is typed (for the preview). Subscribing does not re-render this form.
  const { subscribe } = form
  useEffect(() => subscribe({ formState: { values: true }, callback: ({ values }) => onChange(values) }), [subscribe, onChange])

  return (
    <form
      onSubmit={form.handleSubmit(props.onSubmit)}
      noValidate
      aria-label={props.title}
      className="rounded-lg border border-slate-300 bg-slate-50 p-4"
    >
      <h3 className="mb-3 text-base font-semibold text-slate-900">{props.title}</h3>
      {props.errorKey && <Alert kind="error">{t(props.errorKey)}</Alert>}
      {/* Plain text: it is stored and rendered as text, never as HTML. */}
      <TextAreaField
        label={t('documents.items.fields.description')}
        rows={2}
        maxLength={DESCRIPTION_MAX_LENGTH}
        aria-required="true"
        errorKey={errors.description?.message}
        {...form.register('description')}
      />
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <DecimalField
          control={form.control}
          name="quantity"
          kind="quantity"
          label={t('documents.items.fields.quantity')}
          errorKey={errors.quantity?.message}
        />
        <DecimalField
          control={form.control}
          name="unit_price"
          kind="amount"
          label={t('documents.items.fields.unitPrice')}
          errorKey={errors.unit_price?.message}
        />
        <DecimalField
          control={form.control}
          name="tva_rate"
          kind="rate"
          label={t('documents.items.fields.tvaRate')}
          hint={props.tvaRateHint}
          errorKey={errors.tva_rate?.message}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="grow sm:grow-0">
          <SubmitButton label={props.submitLabel} pendingLabel={props.pendingLabel} pending={props.pending} />
        </div>
        {props.onCancel && (
          <button type="button" disabled={props.pending} onClick={props.onCancel} className={secondaryButton}>
            {t('documents.items.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}
