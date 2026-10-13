import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/context'
import { Alert } from '../components/FormControls'
import { useCurrentOrganization } from '../features/organizations/useCurrentOrganization'
import { errorMessageKey } from '../lib/errors'

// Dashboard of the authenticated area, rendered inside <AppLayout> (which owns the
// navigation and the sign-out button). It handles the three states of the organization:
// loading, could not be prepared (retry), or available.
export function AppHomePage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const organization = useCurrentOrganization()

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">{t('home.title')}</h1>

      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-slate-500">{t('home.signedInAs')}</dt>
          {/* Rendered as text: React escapes it. */}
          <dd className="break-words text-slate-900">{session?.user.email}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">{t('home.organization')}</dt>
          <dd className="break-words text-slate-900">
            {organization.isPending && <span role="status">{t('app.loading')}</span>}
            {/* User-provided text, rendered as text only (never as HTML). */}
            {organization.isSuccess && organization.data.name}
            {organization.isError && '—'}
          </dd>
        </div>
      </dl>

      {organization.isError && (
        <div className="mt-5">
          <Alert kind="error">
            {t('home.accountError')} {t(errorMessageKey(organization.error))}
          </Alert>
          <button
            type="button"
            disabled={organization.isFetching}
            onClick={() => void organization.refetch()}
            className="rounded-md bg-blue-700 px-4 py-2.5 text-base font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60"
          >
            {organization.isFetching ? t('home.retrying') : t('home.retry')}
          </button>
        </div>
      )}

      {organization.isSuccess && <p className="mt-5 text-sm text-slate-600">{t('home.comingSoon')}</p>}
    </div>
  )
}
