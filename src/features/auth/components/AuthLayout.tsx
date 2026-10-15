import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import logoUrl from '../../../assets/facturek-logo.webp'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <img src={logoUrl} alt={t('app.name')} width={174} height={36} className="mx-auto mb-6 h-9 w-auto" />
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-5 text-xl font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  )
}
