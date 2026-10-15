import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Alert, TextLink } from '../../../components/FormControls'
import { primaryButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { documentsKey } from '../api'
import { convertDevisToFacture, convertedFactureKey, findConvertedFacture } from '../conversionApi'
import { formatDocumentNumber, statusKey } from '../format'
import { CancelDevisPanel } from './CancelDevisPanel'

type DevisActionsProps = {
  organizationId: string
  devisId: string
}

const CONVERT_ERRORS = { PGRST116: 'documents.convert.errors.notFound' }

/**
 * What can be done with an issued devis whose status is 'sent':
 *   * "Créer la facture": a draft facture with the client, the notes and the lines of the
 *     devis (Postgres does it in one transaction). One facture per devis: once it exists,
 *     the block links to it instead.
 *   * "Annuler le devis": only while no facture was made from it (DF021 otherwise), so it
 *     is not offered then.
 * Creating the facture is not irreversible (the draft can be deleted), but it blocks the
 * cancellation, so it asks first too.
 */
export function DevisActions({ organizationId, devisId }: DevisActionsProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const questionId = useId()
  const [asking, setAsking] = useState(false)
  const sending = useRef(false)

  const converted = useQuery({
    queryKey: convertedFactureKey(organizationId, devisId),
    retry: false,
    queryFn: () => findConvertedFacture(organizationId, devisId),
  })

  const convert = useMutation({
    mutationFn: () => convertDevisToFacture(organizationId, devisId),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
      await navigate(`/app/documents/${id}`)
    },
    onError: async () => {
      setAsking(false)
      // DF025: a facture was made from it elsewhere; show it.
      await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
    },
    onSettled: () => {
      sending.current = false
    },
  })

  // The second click of a double click (detail 2) must not confirm: see IssuePanel.
  const send = (event: { detail: number }) => {
    if (event.detail > 1) return
    if (sending.current || convert.isPending) return
    sending.current = true
    convert.mutate()
  }

  if (converted.isPending) return <p role="status" className="mt-6 text-sm text-slate-600">{t('app.loading')}</p>
  if (converted.isError) {
    return (
      <div className="mt-6">
        <Alert kind="error">{t(errorMessageKey(converted.error))}</Alert>
      </div>
    )
  }

  const facture = converted.data
  return (
    <>
      <section aria-labelledby="convert-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 id="convert-title" className="text-lg font-semibold text-slate-900">
          {t('documents.convert.title')}
        </h2>

        {facture !== null ? (
          <p className="mt-2 text-sm text-slate-700">
            {facture.status === 'draft'
              ? t('documents.convert.doneDraft')
              : t('documents.convert.doneIssued', {
                  number: formatDocumentNumber(facture.year, facture.number),
                  status: t(statusKey('facture', facture.status)),
                })}{' '}
            <TextLink to={`/app/documents/${facture.id}`}>{t('documents.convert.open')}</TextLink>
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">{t('documents.convert.intro')}</p>
            {convert.isError && (
              <div className="mt-3">
                <Alert kind="error">{t(errorMessageKey(convert.error, CONVERT_ERRORS))}</Alert>
              </div>
            )}
            {!asking ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    convert.reset()
                    setAsking(true)
                  }}
                  className={primaryButton}
                >
                  {t('documents.convert.button')}
                </button>
              </div>
            ) : (
              <div role="group" aria-labelledby={questionId} className="mt-4 rounded-md border border-slate-300 p-4">
                <h3 id={questionId} className="text-base font-semibold text-slate-900">
                  {t('documents.convert.question')}
                </h3>
                <p className="mt-2 text-sm text-slate-900">{t('documents.convert.consequence')}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" disabled={convert.isPending} onClick={send} className={primaryButton}>
                    {convert.isPending ? t('documents.convert.confirming') : t('documents.convert.confirm')}
                  </button>
                  <button
                    type="button"
                    // The keyboard lands on the safe choice.
                    autoFocus
                    disabled={convert.isPending}
                    onClick={() => setAsking(false)}
                    className={secondaryButton}
                  >
                    {t('documents.convert.back')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {facture === null && <CancelDevisPanel organizationId={organizationId} devisId={devisId} />}
    </>
  )
}
