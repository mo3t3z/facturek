import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/context'
import { Alert } from '../features/auth/components/FormControls'
import { useCurrentOrganization } from '../features/organizations/useCurrentOrganization'
import { errorMessageKey } from '../lib/errors'
import { supabase } from '../lib/supabase'

// Placeholder for the authenticated area. The invoicing screens arrive in the next phase.
// It already handles the three states every later screen must handle: the organization is
// loading, could not be prepared (retry), or is available.
export function AppHomePage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const organization = useCurrentOrganization()

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">{t('app.name')}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{t('home.title')}</h1>

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

        <button
          type="button"
          onClick={() => void supabase.auth.signOut()}
          className="mt-6 rounded-md border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
        >
          {t('auth.logout')}
        </button>
      </div>
    </main>
  )
}
