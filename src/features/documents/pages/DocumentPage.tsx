import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Alert, TextLink } from '../../../components/FormControls'
import { errorMessageKey } from '../../../lib/errors'
import { clientsKey, listClients } from '../../clients/api'
import { useOrganization } from '../../organizations/useOrganization'
import { type DocumentDetail, documentsKey, getDocument, updateDraftHeader } from '../api'
import { DraftForm } from '../components/DraftForm'
import { IssuedDocument } from '../components/IssuedDocument'
import { ItemsEditor } from '../components/ItemsEditor'
import { DOCUMENT_WRITE_ERRORS } from '../format'
import { documentIdSchema, type NewDraftValues } from '../schemas'

const DRAFT_TITLES = { devis: 'documents.update.titleDevis', facture: 'documents.update.titleFacture' } as const

type DraftHeaderProps = { organizationId: string; document: DocumentDetail; onDirtyChange: (dirty: boolean) => void }

function DraftHeader({ organizationId, document, onDirtyChange }: DraftHeaderProps) {
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
          onDirtyChange={onDirtyChange}
        />
      )}
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
  // Unsaved changes in the header form block "Émettre": what is issued is what is SAVED.
  const [headerDirty, setHeaderDirty] = useState(false)

  const document = useQuery({
    queryKey: [...documentsKey(organization.id), 'detail', documentId],
    enabled: documentId !== null,
    // The form is filled once, when it mounts: it must get the stored values, not a cached copy.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // A refetch would not refill the form, and must not swap it for the read-only view
    // behind the user's back; the save itself reports a document that is no longer a draft.
    // (Issuing the document invalidates this query on purpose: the issued view replaces the form.)
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

  // Only a draft can be edited: its header, its lines, then the totals preview and the
  // issue panel. Anything else is shown read-only, from what was stored when it was issued.
  if (document.data.status !== 'draft') return <IssuedDocument organizationId={organization.id} document={document.data} />
  return (
    <>
      <DraftHeader organizationId={organization.id} document={document.data} onDirtyChange={setHeaderDirty} />
      <ItemsEditor
        organizationId={organization.id}
        documentId={document.data.id}
        documentType={document.data.type}
        editable
        // The client of the SAVED document: a client chosen in the form but not saved does not count.
        hasClient={document.data.client_id !== null}
        headerDirty={headerDirty}
      />
    </>
  )
}
