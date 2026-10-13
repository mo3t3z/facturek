import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Alert, TextLink } from '../../../components/FormControls'
import { primaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { clientsKey, listClients } from '../../clients/api'
import { useOrganization } from '../../organizations/useOrganization'
import { createDraft, documentsKey } from '../api'
import { DraftForm } from '../components/DraftForm'
import { DOCUMENT_WRITE_ERRORS } from '../format'
import { isDocumentType, type NewDraftValues } from '../schemas'

const TITLES = { devis: 'documents.create.titleDevis', facture: 'documents.create.titleFacture' } as const

// Creates a DRAFT: a document without a number. Only finalize_document() in Postgres
// gives a number, and it is not part of this screen.
export function DocumentCreatePage() {
  const { t } = useTranslation()
  const organization = useOrganization()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // ?type= comes from the URL: only the two known values are used, anything else means
  // "let the user choose".
  const requested = params.get('type')
  const type = isDocumentType(requested) ? requested : null

  const clients = useQuery({
    queryKey: clientsKey(organization.id),
    retry: false,
    queryFn: () => listClients(organization.id),
  })

  const create = useMutation({
    mutationFn: (values: NewDraftValues) => createDraft(organization.id, values),
    onSuccess: async (documentId) => {
      await queryClient.invalidateQueries({ queryKey: documentsKey(organization.id) })
      await navigate(`/app/documents/${documentId}`)
    },
  })

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t(type ? TITLES[type] : 'documents.create.titleAny')}</h1>

      {clients.isPending && <p role="status">{t('app.loading')}</p>}

      {clients.isError && (
        <>
          <Alert kind="error">{t(errorMessageKey(clients.error))}</Alert>
          <TextLink to="/app/documents">{t('documents.backToList')}</TextLink>
        </>
      )}

      {clients.isSuccess && clients.data.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="mb-4 text-base text-slate-900">{t('documents.noClients.message')}</p>
          <Link to="/app/clients/new" className={primaryButton}>
            {t('documents.noClients.action')}
          </Link>
        </div>
      )}

      {clients.isSuccess && clients.data.length > 0 && (
        <DraftForm
          defaultValues={{ type: type ?? '', client_id: '', issue_date: '', due_date: '', notes: '' }}
          chooseType={type === null}
          clients={clients.data}
          onSubmit={(values) => create.mutate(values)}
          pending={create.isPending}
          errorKey={create.isError ? errorMessageKey(create.error, DOCUMENT_WRITE_ERRORS) : null}
          savedKey={null}
          submitLabel={t('documents.create.submit')}
          pendingLabel={t('documents.create.submitting')}
        />
      )}
    </>
  )
}
