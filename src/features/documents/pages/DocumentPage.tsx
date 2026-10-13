import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Alert, TextLink } from '../../../components/FormControls'
import { errorMessageKey } from '../../../lib/errors'
import { clientsKey, listClients } from '../../clients/api'
import { useOrganization } from '../../organizations/useOrganization'
import { type DocumentDetail, documentsKey, getDocument, updateDraftHeader } from '../api'
import { DraftForm } from '../components/DraftForm'
import { ItemsEditor } from '../components/ItemsEditor'
import { formatDay } from '../dates'
import { DOCUMENT_WRITE_ERRORS, formatDocumentNumber, statusKey, typeKey } from '../format'
import { documentIdSchema, type NewDraftValues } from '../schemas'

const DRAFT_TITLES = { devis: 'documents.update.titleDevis', facture: 'documents.update.titleFacture' } as const

function DraftHeader({ organizationId, document }: { organizationId: string; document: DocumentDetail }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const clients = useQuery({
    queryKey: clientsKey(organizationId),
    retry: false,
    queryFn: () => listClients(organizationId),
  })

  const save = useMutation({
    // The type of an existing draft cannot change: only the header is sent.
    mutationFn: (values: NewDraftValues) => updateDraftHeader(organizationId, document.id, values),
    onSettled: () => queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) }),
  })

  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-slate-900">{t(DRAFT_TITLES[document.type])}</h1>
      <p className="mb-4 text-sm text-slate-600">{t('documents.update.intro')}</p>
      {clients.isPending && <p role="status">{t('app.loading')}</p>}
      {clients.isError && <Alert kind="error">{t(errorMessageKey(clients.error))}</Alert>}
      {clients.isSuccess && (
        <DraftForm
          defaultValues={{
            type: document.type,
            client_id: document.client_id ?? '',
            issue_date: document.issue_date ?? '',
            due_date: document.due_date ?? '',
            notes: document.notes ?? '',
          }}
          chooseType={false}
          clients={clients.data}
          onSubmit={(values) => save.mutate(values)}
          pending={save.isPending}
          errorKey={save.isError ? errorMessageKey(save.error, DOCUMENT_WRITE_ERRORS) : null}
          savedKey={save.isSuccess ? 'documents.update.saved' : null}
          submitLabel={t('documents.update.submit')}
          pendingLabel={t('documents.update.submitting')}
        />
      )}
    </>
  )
}

// Read-only summary of an issued document, from its own snapshot columns (what was
// printed on it), not from the client's current record. The full issued view, with lines
// and totals, comes with finalizing.
function IssuedSummary({ document }: { document: DocumentDetail }) {
  const { t } = useTranslation()
  const none = t('documents.columns.noValue')
  const rows: [string, string][] = [
    [t('documents.columns.status'), t(statusKey(document.type, document.status))],
    [t('documents.issued.buyer'), document.buyer_name ?? none],
    [t('documents.issued.buyerMatricule'), document.buyer_matricule_fiscal ?? none],
    [t('documents.issued.buyerAddress'), document.buyer_address ?? none],
    [t('documents.columns.issueDate'), document.issue_date ? formatDay(document.issue_date) : none],
    [t('documents.columns.dueDate'), document.due_date ? formatDay(document.due_date) : none],
  ]
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-slate-900">
        {t(typeKey(document.type))} {formatDocumentNumber(document.year, document.number)}
      </h1>
      <p role="note" className="mb-4 text-sm text-slate-600">
        {t('documents.issued.notice')}
      </p>
      <dl className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium text-slate-500">{label}</dt>
            {/* User-provided text (snapshot), rendered as text only. */}
            <dd className="whitespace-pre-line break-words text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <TextLink to="/app/documents">{t('documents.backToList')}</TextLink>
    </>
  )
}

export function DocumentPage() {
  const { t } = useTranslation()
  const organization = useOrganization()
  // The id comes from the URL: anything that is not a uuid is simply "not found" and is
  // never sent to the database.
  const parsedId = documentIdSchema.safeParse(useParams().documentId)
  const documentId = parsedId.success ? parsedId.data : null

  const document = useQuery({
    queryKey: [...documentsKey(organization.id), 'detail', documentId],
    enabled: documentId !== null,
    // The form is filled once, when it mounts: it must get the stored values, not a cached copy.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // A refetch would not refill the form, and must not swap it for the read-only view
    // behind the user's back; the save itself reports a document that is no longer a draft.
    refetchOnWindowFocus: false,
    queryFn: () => getDocument(organization.id, documentId ?? ''),
  })

  const notFound = documentId === null || (document.isSuccess && document.data === null)

  if (notFound) {
    return (
      <>
        <Alert kind="error">{t('documents.notFound')}</Alert>
        <TextLink to="/app/documents">{t('documents.backToList')}</TextLink>
      </>
    )
  }
  if (document.isError) {
    return (
      <>
        <Alert kind="error">
          {t('documents.loadError')} {t(errorMessageKey(document.error))}
        </Alert>
        <TextLink to="/app/documents">{t('documents.backToList')}</TextLink>
      </>
    )
  }
  if (!document.isSuccess || document.data === null) return <p role="status">{t('app.loading')}</p>

  // Only a draft can be edited: its header above, its lines below. An issued document
  // shows the same lines read-only.
  const isDraft = document.data.status === 'draft'
  return (
    <>
      {isDraft ? <DraftHeader organizationId={organization.id} document={document.data} /> : <IssuedSummary document={document.data} />}
      <ItemsEditor organizationId={organization.id} documentId={document.data.id} documentType={document.data.type} editable={isDraft} />
    </>
  )
}
