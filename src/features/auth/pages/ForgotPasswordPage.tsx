import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { errorMessageKey, isNetworkError } from '../../../lib/errors'
import { supabase } from '../../../lib/supabase'
import { AuthLayout } from '../components/AuthLayout'
import { Alert, SubmitButton, TextField, TextLink } from '../../../components/FormControls'
import { type ForgotPasswordValues, forgotPasswordSchema } from '../schemas'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) })

  const request = useMutation({
    mutationFn: async (values: ForgotPasswordValues) => {
      const { error } = await supabase.auth.resetPasswordForEmail(values.email)
      // Anti-enumeration: whatever the server answered (unknown address, rate limit for
      // an existing one, ...) the visitor sees the same confirmation. Only "the request
      // never reached the server" is reported, because that says nothing about the address.
      if (error && isNetworkError(error)) throw error
    },
  })

  if (request.isSuccess) {
    return (
      <AuthLayout title={t('auth.forgot.sentTitle')}>
        <Alert kind="success">{t('auth.forgot.sent')}</Alert>
        <TextLink to="/login">{t('auth.backToLogin')}</TextLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.forgot.title')}>
      {request.isError && <Alert kind="error">{t(errorMessageKey(request.error))}</Alert>}
      <p className="mb-4 text-sm text-slate-600">{t('auth.forgot.intro')}</p>
      <form onSubmit={form.handleSubmit((values) => request.mutate(values))} noValidate>
        <TextField
          label={t('auth.fields.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          errorKey={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <SubmitButton label={t('auth.forgot.submit')} pendingLabel={t('auth.forgot.submitting')} pending={request.isPending} />
      </form>
      <p className="mt-4">
        <TextLink to="/login">{t('auth.backToLogin')}</TextLink>
      </p>
    </AuthLayout>
  )
}
