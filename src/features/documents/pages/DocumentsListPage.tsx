import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { Alert } from '../../../components/FormControls'
import { dangerButton, primaryButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { useOrganization } from '../../organizations/useOrganization'
import { deleteDraft, type DocumentFilters, type DocumentListItem, DOCUMENTS_LIMIT, documentsKey, listDocuments } from '../api'
import { formatDay } from '../dates'
import { DOCUMENT_WRITE_ERRORS, formatDocumentNumber, statusKey, typeKey } from '../format'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, isDocumentStatus, isDocumentType } from '../schemas'

const selectClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600'

export function DocumentsListPage() {
  const { t } = useTranslation()
  const organization = useOrganization()
  const queryClient = useQueryClient()
  const typeId = useId()
  const statusId = useId()
  const [confirming, setConfirming] = useState<string | null>(null)

  // The filters live in the URL (?type=&status=) so "back" returns to the same list.
  // They come from the URL: only known values are used, anything else means "all".
  const [params, setParams] = useSearchParams()
  const requestedType = params.get('type')
  const requestedStatus = params.get('status')
  const filters: DocumentFilters = {
    type: isDocumentType(requestedType) ? requestedType : null,
    status: isDocumentStatus(requestedStatus) ? requestedStatus : null,
  }
  const filtered = filters.type !== null || filters.status !== null
  const setFilter = (name: 'type' | 'status', value: string) => {
    const next = new URLSearchParams(params)
    if (value === '') next.delete(name)
    else next.set(name, value)
    setParams(next, { replace: true })
  }

  const documents = useQuery({
    queryKey: [...documentsKey(organization.id), 'list', filters.type, filters.status],
    // No silent retries: a failure is shown at once, with a retry button.
    retry: false,
    queryFn: () => listDocuments(organization.id, filters),
  })

  const remove = useMutation({
    mutationFn: (document: DocumentListItem) => deleteDraft(organization.id, document.id),
    onSettled: async () => {
      setConfirming(null)
      await queryClient.invalidateQueries({ queryKey: documentsKey(organization.id) })
    },
  })

  const none = t('documents.columns.noValue')
  /** The name printed on an issued document wins over the client's current name. */
  const clientName = (document: DocumentListItem) => document.buyer_name ?? document.client?.name ?? t('documents.columns.noClient')
  const label = (document: DocumentListItem) => {
    const number = formatDocumentNumber(document.year, document.number)
    const names = { type: t(typeKey(document.type)), client: clientName(document) }
    return number === null ? t('documents.draftLabel', names) : t('documents.issuedLabel', { ...names, number })
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{t('documents.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/documents/new?type=devis" className={primaryButton}>
            {t('documents.newDevis')}
          </Link>
          <Link to="/app/documents/new?type=facture" className={primaryButton}>
            {t('documents.newFacture')}
          </Link>
        </div>
      </div>

      <fieldset className="mb-4 grid grid-cols-2 gap-3">
        <legend className="sr-only">{t('documents.filters.legend')}</legend>
        <div>
          <label htmlFor={typeId} className="mb-1 block text-sm font-medium text-slate-700">
            {t('documents.filters.type')}
          </label>
          <select id={typeId} value={filters.type ?? ''} onChange={(event) => setFilter('type', event.target.value)} className={selectClass}>
            <option value="">{t('documents.filters.all')}</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(typeKey(type))}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={statusId} className="mb-1 block text-sm font-medium text-slate-700">
            {t('documents.filters.status')}
          </label>
          <select id={statusId} value={filters.status ?? ''} onChange={(event) => setFilter('status', event.target.value)} className={selectClass}>
            <option value="">{t('documents.filters.all')}</option>
            {DOCUMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`documents.status.any.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {remove.isError && <Alert kind="error">{t(errorMessageKey(remove.error, DOCUMENT_WRITE_ERRORS))}</Alert>}

      {documents.isPending && <p role="status">{t('app.loading')}</p>}

      {documents.isError && (
        <div>
          <Alert kind="error">
            {t('documents.loadError')} {t(errorMessageKey(documents.error))}
          </Alert>
          <button type="button" onClick={() => void documents.refetch()} className={primaryButton}>
            {t('home.retry')}
          </button>
        </div>
      )}

      {documents.isSuccess && (
        <>
          {documents.data.length >= DOCUMENTS_LIMIT && (
            <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('documents.truncated', { count: DOCUMENTS_LIMIT })}
            </p>
          )}
          <p role="status" className="mb-3 text-sm text-slate-600">
            {documents.data.length > 0
              ? t('documents.count', { count: documents.data.length })
              : filtered
                ? t('documents.noMatch')
                : t('documents.empty')}
          </p>
          <ul className="space-y-3">
            {documents.data.map((document) => {
              const number = formatDocumentNumber(document.year, document.number)
              const isDraft = document.status === 'draft'
              return (
                <li key={document.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="break-words text-base font-semibold text-slate-900">
                    {t(typeKey(document.type))} {number ?? ''}
                    <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium text-slate-700">
                      {t(statusKey(document.type, document.status))}
                    </span>
                  </h2>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-slate-500">{t('documents.columns.number')}</dt>
                    <dd className="text-slate-900">{number ?? t('documents.columns.noNumber')}</dd>
                    <dt className="text-slate-500">{t('documents.columns.client')}</dt>
                    {/* User-provided text, rendered as text only (never as HTML). */}
                    <dd className="break-words text-slate-900">{clientName(document)}</dd>
                    <dt className="text-slate-500">{t('documents.columns.issueDate')}</dt>
                    <dd className="text-slate-900">{document.issue_date ? formatDay(document.issue_date) : none}</dd>
                    <dt className="text-slate-500">{t('documents.columns.dueDate')}</dt>
                    <dd className="text-slate-900">{document.due_date ? formatDay(document.due_date) : none}</dd>
                    {/* Totals arrive with the lines and with finalizing. */}
                    <dt className="text-slate-500">{t('documents.columns.total')}</dt>
                    <dd className="text-slate-900">{none}</dd>
                  </dl>

                  {confirming === document.id ? (
                    <div role="group" aria-label={t('documents.actionNamed', { action: t('documents.delete'), label: label(document) })} className="mt-3">
                      <p className="mb-2 break-words text-sm font-medium text-slate-900">
                        {t('documents.deleteQuestion', { label: label(document) })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(document)} className={dangerButton}>
                          {remove.isPending ? t('documents.deleting') : t('documents.deleteConfirm')}
                        </button>
                        <button
                          type="button"
                          // The keyboard lands on the safe choice.
                          autoFocus
                          disabled={remove.isPending}
                          onClick={() => setConfirming(null)}
                          className={secondaryButton}
                        >
                          {t('documents.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to={`/app/documents/${document.id}`}
                        aria-label={t('documents.actionNamed', { action: t(isDraft ? 'documents.edit' : 'documents.open'), label: label(document) })}
                        className={secondaryButton}
                      >
                        {t(isDraft ? 'documents.edit' : 'documents.open')}
                      </Link>
                      {/* Only a draft can be deleted: an issued document keeps its number for ever. */}
                      {isDraft && (
                        <button
                          type="button"
                          aria-label={t('documents.actionNamed', { action: t('documents.delete'), label: label(document) })}
                          onClick={() => {
                            remove.reset()
                            setConfirming(document.id)
                          }}
                          className={secondaryButton}
                        >
                          {t('documents.delete')}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
