import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Alert, SubmitButton, TextField, TextLink } from '../../../components/FormControls'
import { type ClientValues, clientSchema } from '../schemas'

type ClientFormProps = {
  defaultValues: ClientValues
  onSubmit: (values: ClientValues) => void
  pending: boolean
  /** i18n key of the error returned by the last save, if any. */
  errorKey: string | null
  submitLabel: string
  pendingLabel: string
}

export function ClientForm({ defaultValues, onSubmit, pending, errorKey, submitLabel, pendingLabel }: ClientFormProps) {
  const { t } = useTranslation()
  const form = useForm<ClientValues>({ resolver: zodResolver(clientSchema), defaultValues })
  const errors = form.formState.errors

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      {errorKey && <Alert kind="error">{t(errorKey)}</Alert>}
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <TextField
          label={t('clients.fields.name')}
          autoComplete="off"
          aria-required="true"
          errorKey={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={t('clients.fields.matricule')}
          hint={t('clients.fields.matriculeHint')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          errorKey={errors.matricule_fiscal?.message}
          {...form.register('matricule_fiscal')}
        />
        <TextField
          label={t('clients.fields.address')}
          hint={t('clients.fields.optional')}
          autoComplete="off"
          errorKey={errors.address?.message}
          {...form.register('address')}
        />
        <TextField
          label={t('clients.fields.email')}
          hint={t('clients.fields.optional')}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          errorKey={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={t('clients.fields.phone')}
          hint={t('clients.fields.optional')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          errorKey={errors.phone?.message}
          {...form.register('phone')}
        />
        <SubmitButton label={submitLabel} pendingLabel={pendingLabel} pending={pending} />
      </form>
      <div className="mt-4">
        <TextLink to="/app/clients">{t('clients.backToList')}</TextLink>
      </div>
    </div>
  )
}
