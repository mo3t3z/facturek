import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { safeRedirectPath } from '../../lib/safeRedirect'
import { useAuth } from './context'

// These guards are UX only: they decide which screen to show. They protect nothing.
// The data is protected by Row Level Security in Postgres.

function FullPageLoading() {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex min-h-screen items-center justify-center text-slate-500">
      {t('app.loading')}
    </div>
  )
}

/** Private area: a visitor without a session is sent to /login and comes back afterwards. */
export function RequireAuth() {
  const { session, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <FullPageLoading />
  if (!session) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

/** Login / signup pages: a user who is already logged in has nothing to do there. */
export function RedirectIfAuthed() {
  const { session, isLoading } = useAuth()
  const [params] = useSearchParams()
  if (isLoading) return <FullPageLoading />
  // ?next= comes from the URL: it is only followed if it is a path inside this app.
  if (session) return <Navigate to={safeRedirectPath(params.get('next'))} replace />
  return <Outlet />
}
