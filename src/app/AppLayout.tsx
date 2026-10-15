import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { supabase } from '../lib/supabase'
import logoUrl from '../assets/facturek-logo.webp'

const navLink =
  'rounded-md px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 aria-[current=page]:bg-blue-50 aria-[current=page]:text-blue-800'

// Shell of the authenticated area: header, main navigation, then the current screen.
// Phone first: one column, the navigation wraps under the title on a narrow screen.
// It shows nothing that depends on the organization, so it still works (and still lets
// the user sign out) when the account could not be prepared.
export function AppLayout() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:ring-2 focus:ring-blue-600"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <img src={logoUrl} alt={t('app.name')} width={116} height={24} className="h-6 w-auto" />
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
          >
            {t('auth.logout')}
          </button>
          <nav aria-label={t('nav.label')} className="w-full">
            <ul className="flex flex-wrap gap-1">
              <li>
                {/* `end`: /app is only "current" on the dashboard itself, not on /app/clients. */}
                <NavLink to="/app" end className={navLink}>
                  {t('nav.home')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/app/documents" className={navLink}>
                  {t('nav.documents')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/app/clients" className={navLink}>
                  {t('nav.clients')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/app/settings" className={navLink}>
                  {t('nav.settings')}
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="contenu" className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
