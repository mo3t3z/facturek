import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Alert, SelectField, SubmitButton, TextAreaField, TextField, TextLink } from '../../../components/FormControls'
import type { Client } from '../../clients/api'
import { typeKey } from '../format'
import { DOCUMENT_TYPES, type NewDraftInput, type NewDraftValues, newDraftSchema } from '../schemas'

type DraftFormProps = {
  defaultValues: NewDraftInput
  /** True when the type is not known yet and the user must choose it. */
  chooseType: boolean
  clients: readonly Client[]
  onSubmit: (values: NewDraftValues) => void
  pending: boolean
  /** i18n key of the error returned by the last save, if any. */
  errorKey: string | null
  /** i18n key of the confirmation shown after a successful save, if any. */
  savedKey: string | null
  submitLabel: string
  pendingLabel: string
  /** Told whether the form holds changes that are not saved (the issue panel needs it). */
  onDirtyChange?: (dirty: boolean) => void
}

/** The header of a draft: type (when it must be chosen), client, dates and notes. */
export function DraftForm(props: DraftFormProps) {
  const { t } = useTranslation()
  const form = useForm<NewDraftInput, unknown, NewDraftValues>({
    resolver: zodResolver(newDraftSchema),
    defaultValues: props.defaultValues,
  })
  const errors = form.formState.errors
  const { isDirty } = form.formState
  const { savedKey, onDirtyChange } = props

  // "Dirty" means different from what is SAVED. After a successful save the values in the
  // form are the saved ones: they become the new reference.
  useEffect(() => {
    if (savedKey) form.reset(form.getValues())
  }, [savedKey, form])
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      {props.errorKey && <Alert kind="error">{t(props.errorKey)}</Alert>}
      {props.savedKey && <Alert kind="success">{t(props.savedKey)}</Alert>}
      <form onSubmit={form.handleSubmit(props.onSubmit)} noValidate>
        {props.chooseType && (
          <SelectField label={t('documents.fields.type')} aria-required="true" errorKey={errors.type?.message} {...form.register('type')}>
            <option value="">{t('documents.fields.chooseType')}</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(typeKey(type))}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField
          label={t('documents.fields.client')}
          aria-required="true"
          errorKey={errors.client_id?.message}
          {...form.register('client_id')}
        >
          <option value="">{t('documents.fields.chooseClient')}</option>
          {props.clients.map((client) => (
            // User-provided text, rendered as text only.
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
        {/* type="date": the browser gives "YYYY-MM-DD" (or ""), which is kept as text. */}
        <TextField
          label={t('documents.fields.issueDate')}
          hint={t('documents.fields.issueDateHint')}
          type="date"
          errorKey={errors.issue_date?.message}
          {...form.register('issue_date')}
        />
        <TextField
          label={t('documents.fields.dueDate')}
          hint={t('documents.fields.optional')}
          type="date"
          errorKey={errors.due_date?.message}
          {...form.register('due_date')}
        />
        <TextAreaField
          label={t('documents.fields.notes')}
          hint={t('documents.fields.notesHint')}
          errorKey={errors.notes?.message}
          {...form.register('notes')}
        />
        <SubmitButton label={props.submitLabel} pendingLabel={props.pendingLabel} pending={props.pending} />
      </form>
      <div className="mt-4">
        <TextLink to="/app/documents">{t('documents.backToList')}</TextLink>
      </div>
    </div>
  )
}
