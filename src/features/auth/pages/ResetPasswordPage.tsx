import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { errorMessageKey } from '../../../lib/errors'
import { supabase } from '../../../lib/supabase'
import { AuthLayout } from '../components/AuthLayout'
import { Alert, SubmitButton, TextField, TextLink } from '../components/FormControls'
import { useAuth } from '../context'
import { type ResetPasswordValues, resetPasswordSchema } from '../schemas'

/**
 * Only usable in the middle of a recovery: the user has just confirmed a recovery link in
 * this tab (isRecovering) and that gave them a session. Opened any other way (typed URL,
 * reload, ordinary session) it shows nothing but a link to request a new email.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, isRecovering, endRecovery } = useAuth()
  const form = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) })

  const reset = useMutation({
    mutationFn: async (values: ResetPasswordValues) => {
      const { error } = await supabase.auth.updateUser({ password: values.password })
      if (error) throw error
      // The password changed because it may have been compromised: end every OTHER session
      // of this account (other browsers, other devices). This one stays logged in.
      // Best effort: the new password is already saved, so a failure here must not be
      // reported as "your password was not changed".
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined)
    },
    onSuccess: () => {
      endRecovery()
      void navigate('/app', { replace: true })
    },
  })

  if (!session || !isRecovering) {
    return (
      <AuthLayout title={t('auth.reset.invalidTitle')}>
        <Alert kind="error">{t('auth.reset.invalid')}</Alert>
        <TextLink to="/forgot-password">{t('auth.reset.requestNew')}</TextLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.reset.title')}>
      {reset.isError && <Alert kind="error">{t(errorMessageKey(reset.error))}</Alert>}
      <form onSubmit={form.handleSubmit((values) => reset.mutate(values))} noValidate>
        <TextField
          label={t('auth.fields.newPassword')}
          type="password"
          autoComplete="new-password"
          hint={t('auth.fields.passwordHint')}
          errorKey={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <TextField
          label={t('auth.fields.confirmPassword')}
          type="password"
          autoComplete="new-password"
          errorKey={form.formState.errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <SubmitButton label={t('auth.reset.submit')} pendingLabel={t('auth.reset.submitting')} pending={reset.isPending} />
      </form>
    </AuthLayout>
  )
}
