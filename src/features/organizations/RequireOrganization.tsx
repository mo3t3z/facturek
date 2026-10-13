import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { Alert } from '../../components/FormControls'
import { primaryButton } from '../../components/styles'
import { errorMessageKey } from '../../lib/errors'
import { useCurrentOrganization } from './useCurrentOrganization'

// Screens that work on organization data are rendered under this route. They get the
// organization through useOrganization() and never have to handle "not ready yet".
// Like the route guards, this is UX only: the data itself is protected by RLS.
export function RequireOrganization() {
  const { t } = useTranslation()
  const organization = useCurrentOrganization()

  if (organization.isPending) return <p role="status">{t('app.loading')}</p>

  if (organization.isError) {
    return (
      <div>
        <Alert kind="error">
          {t('home.accountError')} {t(errorMessageKey(organization.error))}
        </Alert>
        <button
          type="button"
          disabled={organization.isFetching}
          onClick={() => void organization.refetch()}
          className={primaryButton}
        >
          {organization.isFetching ? t('home.retrying') : t('home.retry')}
        </button>
      </div>
    )
  }

  return <Outlet context={organization.data} />
}
