import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '../../../components/FormControls'
import { dangerButton, primaryButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { formatMillimes, formatQuantity, formatRate, toDbNumeric } from '../../../lib/money/money'
import { getTaxSettings, type TaxSettings, taxSettingsKey } from '../../settings/api'
import { ITEM_WRITE_ERRORS } from '../format'
import { createItem, deleteItem, type DocumentItem, ITEMS_LIMIT, itemsKey, listItems, updateItem } from '../itemsApi'
import { type ItemInput, type ItemValues, readItem } from '../itemSchema'
import { type PendingLine, previewLines, previewLineTotal, previewTimbre, previewTotals } from '../preview'
import type { DocumentType } from '../schemas'
import { IssuePanel } from './IssuePanel'
import { ItemForm } from './ItemForm'
import { TotalsPreview } from './TotalsPreview'

type ItemsEditorProps = {
  organizationId: string
  documentId: string
  documentType: DocumentType
  /** True for a draft. False for an issued document: the lines are shown, nothing can be changed. */
  editable: boolean
  /** The SAVED document has a client (a draft may not). Only used by the issue panel. */
  hasClient: boolean
  /** The header form of the draft has unsaved changes. Only used by the issue panel. */
  headerDirty: boolean
}

const NO_PENDING: PendingLine = { state: 'none' }

// An organization without a tax_settings row applies nothing: no default rate, no timbre.
// finalize_document() reads a missing row the same way.
const NO_TAX_SETTINGS: TaxSettings = { defaultTvaRate: null, timbreEnabled: false, timbreFiscal: null }

/** Stored values shown the way a user would type them (comma, no grouping). */
const asTyped = (item: DocumentItem): ItemInput => ({
  description: item.description,
  quantity: toDbNumeric(item.quantity).replace('.', ','),
  unit_price: toDbNumeric(item.unitPrice).replace('.', ','),
  tva_rate: formatRate(item.tvaRate),
})

/**
 * The lines of a document. For a draft: add, edit and remove a line, one line at a time
 * (each is saved on its own, see itemsApi.ts), and a live totals preview.
 * For an issued document: the same list, read-only, without any form or preview.
 * Under the preview of a draft, the issue panel ("Émettre") works on the SAVED lines only.
 */
export function ItemsEditor({ organizationId, documentId, documentType, editable, hasClient, headerDirty }: ItemsEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // One form at a time: the "add" form, or the form of the line being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  // What is being typed, for the preview only. It is never written anywhere.
  const [pending, setPending] = useState<PendingLine>(NO_PENDING)
  // Changing the key gives a fresh, empty "add" form after a line was added.
  const [addFormKey, setAddFormKey] = useState(0)

  const items = useQuery({
    queryKey: itemsKey(organizationId, documentId),
    retry: false,
    queryFn: () => listItems(organizationId, documentId),
  })
  // Default TVA rate and timbre: only a draft needs them.
  const tax = useQuery({
    queryKey: taxSettingsKey(organizationId),
    enabled: editable,
    retry: false,
    queryFn: () => getTaxSettings(organizationId),
  })

  const afterWrite = async () => {
    setPending(NO_PENDING)
    await queryClient.invalidateQueries({ queryKey: itemsKey(organizationId, documentId) })
  }
  const add = useMutation({
    mutationFn: ({ position, values }: { position: number; values: ItemValues }) => createItem(organizationId, documentId, position, values),
    onSuccess: async () => {
      setAddFormKey((key) => key + 1)
      await afterWrite()
    },
  })
  const save = useMutation({
    mutationFn: ({ itemId, values }: { itemId: string; values: ItemValues }) => updateItem(organizationId, documentId, itemId, values),
    onSuccess: async () => {
      setEditing(null)
      await afterWrite()
    },
  })
  const remove = useMutation({
    mutationFn: (itemId: string) => deleteItem(organizationId, documentId, itemId),
    onSettled: async () => {
      setConfirming(null)
      await afterWrite()
    },
  })

  /** What a form holds -> what the preview may count. `replaces` is the edited line, or null for a new one. */
  const follow = useCallback((replaces: string | null, input: ItemInput) => {
    const untouched = replaces === null && input.description.trim() === '' && input.quantity.trim() === '' && input.unit_price.trim() === ''
    if (untouched) return setPending(NO_PENDING)
    const read = readItem(input)
    setPending(read.ok ? { state: 'complete', replaces, line: read.values } : { state: 'incomplete', replaces })
  }, [])
  const followNew = useCallback((input: ItemInput) => follow(null, input), [follow])
  const followEdited = useCallback((input: ItemInput) => follow(editing, input), [follow, editing])

  const startEditing = (itemId: string) => {
    add.reset()
    save.reset()
    remove.reset()
    setConfirming(null)
    setPending(NO_PENDING)
    setEditing(itemId)
  }
  const stopEditing = () => {
    save.reset()
    setPending(NO_PENDING)
    setEditing(null)
  }

  const amount = (value: Parameters<typeof formatMillimes>[0]) => t('money.amount', { value: formatMillimes(value) })
  const settings = tax.data ?? NO_TAX_SETTINGS
  const defaultRate = settings.defaultTvaRate
  // A new line goes after the last one. Lines are sorted by position, so the last is the highest.
  const nextPosition = (saved: readonly DocumentItem[]) => (saved.at(-1)?.position ?? -1) + 1

  return (
    <section aria-labelledby="items-title" className="mt-8">
      <h2 id="items-title" className="mb-3 text-lg font-semibold text-slate-900">
        {t('documents.items.title')}
      </h2>

      {items.isPending && <p role="status">{t('app.loading')}</p>}
      {items.isError && (
        <div>
          <Alert kind="error">
            {t('documents.items.loadError')} {t(errorMessageKey(items.error))}
          </Alert>
          <button type="button" onClick={() => void items.refetch()} className={primaryButton}>
            {t('home.retry')}
          </button>
        </div>
      )}

      {items.isSuccess && (
        <>
          {items.data.length >= ITEMS_LIMIT && (
            <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t('documents.items.truncated', { count: ITEMS_LIMIT })}
            </p>
          )}
          <p role="status" className="mb-3 text-sm text-slate-600">
            {items.data.length > 0
              ? t('documents.items.count', { count: items.data.length })
              : t(editable ? 'documents.items.empty' : 'documents.items.emptyIssued')}
          </p>
          {remove.isError && <Alert kind="error">{t(errorMessageKey(remove.error, ITEM_WRITE_ERRORS))}</Alert>}

          <ol className="space-y-3">
            {items.data.map((item, index) => {
              const position = index + 1
              const lineTotal = previewLineTotal(item)
              const named = (action: string) => t('documents.items.lineNamed', { action, position, description: item.description })
              return (
                <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  {editable && editing === item.id ? (
                    <ItemForm
                      title={t('documents.items.editTitle', { position })}
                      defaultValues={asTyped(item)}
                      tvaRateHint={t('documents.items.fields.tvaRateHint')}
                      onSubmit={(values) => save.mutate({ itemId: item.id, values })}
                      onChange={followEdited}
                      onCancel={stopEditing}
                      pending={save.isPending}
                      errorKey={save.isError ? errorMessageKey(save.error, ITEM_WRITE_ERRORS) : null}
                      submitLabel={t('documents.items.save')}
                      pendingLabel={t('documents.items.saving')}
                    />
                  ) : (
                    <>
                      {/* User-provided text, rendered as text only (never as HTML). Line breaks are kept. */}
                      <p className="whitespace-pre-line break-words text-base font-medium text-slate-900">
                        <span className="me-2 text-slate-500">{position}.</span>
                        {item.description}
                      </p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                        <div>
                          <dt className="text-slate-500">{t('documents.items.quantity')}</dt>
                          <dd className="text-slate-900">{formatQuantity(item.quantity)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">{t('documents.items.unitPrice')}</dt>
                          <dd className="text-slate-900">{amount(item.unitPrice)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">{t('documents.items.tvaRate')}</dt>
                          <dd className="text-slate-900">{t('money.rate', { value: formatRate(item.tvaRate) })}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">{t('documents.items.lineTotal')}</dt>
                          <dd className="font-medium text-slate-900">{lineTotal === null ? t('documents.columns.noValue') : amount(lineTotal)}</dd>
                        </div>
                      </dl>

                      {editable && confirming === item.id && (
                        <div role="group" aria-label={named(t('documents.items.delete'))} className="mt-3">
                          <p className="mb-2 break-words text-sm font-medium text-slate-900">
                            {t('documents.items.deleteQuestion', { position, description: item.description })}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id)} className={dangerButton}>
                              {remove.isPending ? t('documents.items.deleting') : t('documents.items.deleteConfirm')}
                            </button>
                            <button
                              type="button"
                              // The keyboard lands on the safe choice.
                              autoFocus
                              disabled={remove.isPending}
                              onClick={() => setConfirming(null)}
                              className={secondaryButton}
                            >
                              {t('documents.items.cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {editable && confirming !== item.id && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" aria-label={named(t('documents.items.edit'))} onClick={() => startEditing(item.id)} className={secondaryButton}>
                            {t('documents.items.edit')}
                          </button>
                          <button
                            type="button"
                            aria-label={named(t('documents.items.delete'))}
                            onClick={() => {
                              remove.reset()
                              setConfirming(item.id)
                            }}
                            className={secondaryButton}
                          >
                            {t('documents.items.delete')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ol>

          {editable && tax.isError && <Alert kind="error">{t('documents.preview.settingsError')}</Alert>}

          {/* The default rate must be known before the form is filled: it mounts once the settings answered. */}
          {editable && editing === null && !tax.isPending && (
            <div className="mt-4">
              <ItemForm
                key={addFormKey}
                title={t('documents.items.addTitle')}
                // The rate is proposed only when the organization chose one. Otherwise it is left
                // empty and required: no rate is ever assumed.
                defaultValues={{ description: '', quantity: '', unit_price: '', tva_rate: defaultRate === null ? '' : formatRate(defaultRate) }}
                tvaRateHint={t(defaultRate === null ? 'documents.items.fields.tvaRateNoDefault' : 'documents.items.fields.tvaRateHint')}
                onSubmit={(values) => add.mutate({ position: nextPosition(items.data), values })}
                onChange={followNew}
                pending={add.isPending}
                errorKey={add.isError ? errorMessageKey(add.error, ITEM_WRITE_ERRORS) : null}
                submitLabel={t('documents.items.add')}
                pendingLabel={t('documents.items.adding')}
              />
            </div>
          )}

          {editable && tax.isSuccess && (
            <TotalsPreview
              totals={previewTotals(previewLines(items.data, pending), previewTimbre(documentType, settings))}
              timbre={previewTimbre(documentType, settings)}
              pending={pending.state}
            />
          )}

          {editable && (
            <IssuePanel
              organizationId={organizationId}
              documentId={documentId}
              documentType={documentType}
              hasClient={hasClient}
              lineCount={items.data.length}
              // The SAVED lines only: `pending` (what is being typed) is deliberately left out.
              // This is the amount Postgres will be asked to confirm.
              totals={previewTotals(items.data, previewTimbre(documentType, settings))}
              timbre={previewTimbre(documentType, settings)}
              taxSettings={tax.isSuccess ? 'ready' : tax.isError ? 'error' : 'loading'}
              lineFormBusy={editing !== null || pending.state !== 'none'}
              headerDirty={headerDirty}
            />
          )}
        </>
      )}
    </section>
  )
}
