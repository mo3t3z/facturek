import { useTranslation } from 'react-i18next'

export function HomePage() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <h1 className="text-2xl font-semibold text-slate-900">{t('app.name')}</h1>
    </main>
  )
}
