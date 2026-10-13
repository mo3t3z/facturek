import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { errorMessageKey } from '../../../lib/errors'
import { supabase } from '../../../lib/supabase'
import { AuthLayout } from '../components/AuthLayout'
import { Alert, TextLink } from '../../../components/FormControls'
import { useAuth } from '../context'

const LINK_TYPES = ['email', 'recovery'] as const
type LinkType = (typeof LINK_TYPES)[number]

function isLinkType(value: string | null): value is LinkType {
  return LINK_TYPES.some((type) => type === value)
}

/**
 * Landing page of the links in our emails: /auth/confirm?token_hash=...&type=email|recovery
 *
 * The one-time token is spent only when the user presses the button. Opening the page does
 * nothing, so a mail scanner or a link preview that fetches (or even renders) the URL
 * cannot use the token up before the real user arrives.
 */
export function AuthConfirmPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { beginRecovery } = useAuth()
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  const type = params.get('type')

  const verify = useMutation({
    mutationFn: async (link: { tokenHash: string; type: LinkType }) => {
      const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
      if (error) throw error
      return link.type
    },
    onSuccess: (verifiedType) => {
      // Fixed destinations: nothing from the URL decides where the user goes next.
      if (verifiedType === 'recovery') {
        beginRecovery()
        void navigate('/reset-password', { replace: true })
      } else {
        void navigate('/app', { replace: true })
      }
    },
  })

  if (!tokenHash || !isLinkType(type)) {
    return (
      <AuthLayout title={t('auth.confirm.invalidTitle')}>
        <Alert kind="error">{t('auth.confirm.invalid')}</Alert>
        <TextLink to="/login">{t('auth.backToLogin')}</TextLink>
      </AuthLayout>
    )
  }

  const isRecovery = type === 'recovery'
  return (
    <AuthLayout title={t(isRecovery ? 'auth.confirm.recoveryTitle' : 'auth.confirm.emailTitle')}>
      {verify.isError && <Alert kind="error">{t(errorMessageKey(verify.error))}</Alert>}
      <p className="mb-4 text-sm text-slate-600">
        {t(isRecovery ? 'auth.confirm.recoveryIntro' : 'auth.confirm.emailIntro')}
      </p>
      <button
        type="button"
        disabled={verify.isPending || verify.isSuccess}
        onClick={() => verify.mutate({ tokenHash, type })}
        className="w-full rounded-md bg-blue-700 px-4 py-2.5 text-base font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60"
      >
        {verify.isPending
          ? t('auth.confirm.submitting')
          : t(isRecovery ? 'auth.confirm.recoverySubmit' : 'auth.confirm.emailSubmit')}
      </button>
      {verify.isError && (
        <p className="mt-4">
          <TextLink to={isRecovery ? '/forgot-password' : '/login'}>
            {t(isRecovery ? 'auth.reset.requestNew' : 'auth.backToLogin')}
          </TextLink>
        </p>
      )}
    </AuthLayout>
  )
}
