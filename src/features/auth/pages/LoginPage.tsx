import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { errorMessageKey } from '../../../lib/errors'
import { supabase } from '../../../lib/supabase'
import { AuthLayout } from '../components/AuthLayout'
import { Alert, SubmitButton, TextField, TextLink } from '../../../components/FormControls'
import { type LoginValues, loginSchema } from '../schemas'

export function LoginPage() {
  const { t } = useTranslation()
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  // On success the AuthProvider receives the session and RedirectIfAuthed navigates away
  // (to a validated ?next= path, or to /app).
  const login = useMutation({
    mutationFn: async (values: LoginValues) => {
      const { error } = await supabase.auth.signInWithPassword(values)
      if (error) throw error
    },
  })

  return (
    <AuthLayout title={t('auth.login.title')}>
      {/* errorMessageKey gives ONE message for every kind of login failure. */}
      {login.isError && <Alert kind="error">{t(errorMessageKey(login.error))}</Alert>}
      <form onSubmit={form.handleSubmit((values) => login.mutate(values))} noValidate>
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
        <TextField
          label={t('auth.fields.password')}
          type="password"
          autoComplete="current-password"
          errorKey={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <SubmitButton label={t('auth.login.submit')} pendingLabel={t('auth.login.submitting')} pending={login.isPending} />
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <TextLink to="/forgot-password">{t('auth.login.forgot')}</TextLink>
        <TextLink to="/signup">{t('auth.login.toSignup')}</TextLink>
      </div>
    </AuthLayout>
  )
}
