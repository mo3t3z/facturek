import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../../lib/supabase'
import { errorMessageKey } from '../../../lib/errors'
import { AuthLayout } from '../components/AuthLayout'
import { Alert, SubmitButton, TextField, TextLink } from '../components/FormControls'
import { type SignupValues, signupSchema } from '../schemas'

// Codes that only occur for an address the server already knows: it has an account, or an
// email was sent to it a moment ago. They are treated exactly like a success, so the screen
// never tells a visitor whether an address is registered.
const ALREADY_REGISTERED = new Set(['user_already_exists', 'email_exists', 'over_email_send_rate_limit'])

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export function SignupPage() {
  const { t } = useTranslation()
  const form = useForm<SignupValues>({ resolver: zodResolver(signupSchema) })

  const signup = useMutation({
    mutationFn: async (values: SignupValues) => {
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        // Read by the signup trigger in the database, which creates the profile and the
        // organization. The frontend never inserts those rows itself.
        options: { data: { full_name: values.fullName } },
      })
      if (error && !ALREADY_REGISTERED.has(errorCode(error) ?? '')) throw error
    },
  })

  if (signup.isSuccess) {
    return (
      <AuthLayout title={t('auth.signup.checkInboxTitle')}>
        <Alert kind="success">{t('auth.signup.checkInbox')}</Alert>
        <TextLink to="/login">{t('auth.backToLogin')}</TextLink>
      </AuthLayout>
    )
  }

  const errors = form.formState.errors
  return (
    <AuthLayout title={t('auth.signup.title')}>
      {signup.isError && <Alert kind="error">{t(errorMessageKey(signup.error))}</Alert>}
      <form onSubmit={form.handleSubmit((values) => signup.mutate(values))} noValidate>
        <TextField
          label={t('auth.fields.fullName')}
          autoComplete="name"
          maxLength={100}
          errorKey={errors.fullName?.message}
          {...form.register('fullName')}
        />
        <TextField
          label={t('auth.fields.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          errorKey={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={t('auth.fields.password')}
          type="password"
          autoComplete="new-password"
          hint={t('auth.fields.passwordHint')}
          errorKey={errors.password?.message}
          {...form.register('password')}
        />
        <TextField
          label={t('auth.fields.confirmPassword')}
          type="password"
          autoComplete="new-password"
          errorKey={errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <SubmitButton label={t('auth.signup.submit')} pendingLabel={t('auth.signup.submitting')} pending={signup.isPending} />
      </form>
      <p className="mt-4">
        <TextLink to="/login">{t('auth.signup.toLogin')}</TextLink>
      </p>
    </AuthLayout>
  )
}
