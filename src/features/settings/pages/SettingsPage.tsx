import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalField } from '../../../components/DecimalField'
import { Alert, CheckboxField, SubmitButton, TextField } from '../../../components/FormControls'
import { primaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { formatRate, parseMillimes, parseRate, toDbNumeric } from '../../../lib/money/money'
import { useOrganization } from '../../organizations/useOrganization'
import {
  getOrganizationDetails,
  getTaxSettings,
  type OrganizationDetails,
  organizationDetailsKey,
  type TaxSettings,
  taxSettingsKey,
  updateOrganizationDetails,
  updateTaxSettings,
} from '../api'
import { type OrganizationValues, organizationSchema, type TaxSettingsValues, taxSettingsSchema } from '../schemas'

// PGRST116 = "no row": the UPDATE matched nothing. RLS filtered it out (the user may read
// the settings but not change them) or the row no longer exists.
const SAVE_ERRORS = { PGRST116: 'settings.errors.notSaved' }

// A form is filled once, when it mounts: it must get the stored values, not a cached copy,
// and a failure is shown at once with a retry button.
const FRESH = { staleTime: 0, gcTime: 0, retry: false } as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div>
      <Alert kind="error">
        {t('settings.loadError')} {t(errorMessageKey(error))}
      </Alert>
      <button type="button" onClick={onRetry} className={primaryButton}>
        {t('home.retry')}
      </button>
    </div>
  )
}

function OrganizationForm({ organization }: { organization: OrganizationDetails }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      name: organization.name,
      matricule_fiscal: organization.matricule_fiscal ?? '',
      address: organization.address ?? '',
      email: organization.email ?? '',
      phone: organization.phone ?? '',
    },
  })
  const errors = form.formState.errors

  const save = useMutation({
    mutationFn: (values: OrganizationValues) => updateOrganizationDetails(organization.id, values),
    // The name is shown elsewhere (dashboard): every cached copy of the organization is refreshed.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations'] }),
  })

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
      <p className="mb-4 text-sm text-slate-600">{t('settings.organization.intro')}</p>
      {save.isError && <Alert kind="error">{t(errorMessageKey(save.error, SAVE_ERRORS))}</Alert>}
      {save.isSuccess && <Alert kind="success">{t('settings.saved')}</Alert>}
      <TextField
        label={t('settings.organization.name')}
        autoComplete="organization"
        aria-required="true"
        errorKey={errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label={t('settings.organization.matricule')}
        hint={t('settings.organization.optional')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        errorKey={errors.matricule_fiscal?.message}
        {...form.register('matricule_fiscal')}
      />
      <TextField
        label={t('settings.organization.address')}
        hint={t('settings.organization.optional')}
        autoComplete="street-address"
        errorKey={errors.address?.message}
        {...form.register('address')}
      />
      <TextField
        label={t('settings.organization.email')}
        hint={t('settings.organization.optional')}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        errorKey={errors.email?.message}
        {...form.register('email')}
      />
      <TextField
        label={t('settings.organization.phone')}
        hint={t('settings.organization.optional')}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        errorKey={errors.phone?.message}
        {...form.register('phone')}
      />
      <SubmitButton
        label={t('settings.organization.submit')}
        pendingLabel={t('settings.organization.submitting')}
        pending={save.isPending}
      />
    </form>
  )
}

/** Form text -> stored values. The schema has already checked that every text can be read. */
function toTaxSettings(values: TaxSettingsValues): TaxSettings {
  return {
    defaultTvaRate: values.default_tva_rate.trim() === '' ? null : parseRate(values.default_tva_rate),
    timbreEnabled: values.timbre_enabled,
    timbreFiscal: values.timbre_fiscal.trim() === '' ? null : parseMillimes(values.timbre_fiscal),
  }
}

function TaxSettingsForm({ organizationId, settings }: { organizationId: string; settings: TaxSettings }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<TaxSettingsValues>({
    resolver: zodResolver(taxSettingsSchema),
    // Stored values are shown the way a user would type them; NULL is an empty field.
    defaultValues: {
      default_tva_rate: settings.defaultTvaRate === null ? '' : formatRate(settings.defaultTvaRate),
      timbre_enabled: settings.timbreEnabled,
      timbre_fiscal: settings.timbreFiscal === null ? '' : toDbNumeric(settings.timbreFiscal).replace('.', ','),
    },
  })
  const errors = form.formState.errors

  const save = useMutation({
    mutationFn: (values: TaxSettingsValues) => updateTaxSettings(organizationId, toTaxSettings(values)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taxSettingsKey(organizationId) }),
  })

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
      <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {t('settings.tax.notice')}
      </p>
      {save.isError && <Alert kind="error">{t(errorMessageKey(save.error, SAVE_ERRORS))}</Alert>}
      {save.isSuccess && <Alert kind="success">{t('settings.saved')}</Alert>}
      <DecimalField
        control={form.control}
        name="default_tva_rate"
        kind="rate"
        label={t('settings.tax.defaultRate')}
        hint={t('settings.tax.defaultRateHint')}
        errorKey={errors.default_tva_rate?.message}
      />
      <CheckboxField label={t('settings.tax.timbreEnabled')} {...form.register('timbre_enabled')} />
      <DecimalField
        control={form.control}
        name="timbre_fiscal"
        kind="amount"
        label={t('settings.tax.timbreAmount')}
        hint={t('settings.tax.timbreAmountHint')}
        errorKey={errors.timbre_fiscal?.message}
      />
      <SubmitButton label={t('settings.tax.submit')} pendingLabel={t('settings.tax.submitting')} pending={save.isPending} />
    </form>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const organization = useOrganization()

  const details = useQuery({
    queryKey: organizationDetailsKey(organization.id),
    queryFn: () => getOrganizationDetails(organization.id),
    ...FRESH,
  })
  const tax = useQuery({
    queryKey: taxSettingsKey(organization.id),
    queryFn: () => getTaxSettings(organization.id),
    ...FRESH,
  })

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t('settings.title')}</h1>

      <Section title={t('settings.organization.title')}>
        {details.isPending && <p role="status">{t('app.loading')}</p>}
        {details.isError && <LoadError error={details.error} onRetry={() => void details.refetch()} />}
        {details.isSuccess && details.data === null && <Alert kind="error">{t('settings.loadError')}</Alert>}
        {details.isSuccess && details.data !== null && <OrganizationForm organization={details.data} />}
      </Section>

      <Section title={t('settings.tax.title')}>
        {tax.isPending && <p role="status">{t('app.loading')}</p>}
        {tax.isError && <LoadError error={tax.error} onRetry={() => void tax.refetch()} />}
        {tax.isSuccess && tax.data === null && <Alert kind="error">{t('settings.loadError')}</Alert>}
        {tax.isSuccess && tax.data !== null && <TaxSettingsForm organizationId={organization.id} settings={tax.data} />}
      </Section>
    </>
  )
}
