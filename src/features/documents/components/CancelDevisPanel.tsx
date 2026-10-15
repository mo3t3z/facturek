import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '../../../components/FormControls'
import { dangerButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { documentsKey } from '../api'
import { cancelDevis } from '../paymentsApi'

type CancelDevisPanelProps = {
  organizationId: string
  devisId: string
}

const CANCEL_ERRORS = { PGRST116: 'documents.cancelDevis.errors.notFound' }

/**
 * "Annuler le devis" on an issued devis whose status is 'sent'. Cannot be undone.
 * Nothing is sent before an inline confirmation that lands on "Retour". Postgres decides:
 * only a sent devis (DF012), never one a facture was converted from (DF021).
 */
export function CancelDevisPanel({ organizationId, devisId }: CancelDevisPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const questionId = useId()
  const [asking, setAsking] = useState(false)
  const sending = useRef(false)

  const cancel = useMutation({
    mutationFn: () => cancelDevis(organizationId, devisId),
    onSettled: async () => {
      sending.current = false
      setAsking(false)
      // Success: the page shows the devis as cancelled. Refusal: show what Postgres has now.
      await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
    },
  })

  // The confirm button appears where the button that opened the confirmation was, or near
  // it. The second click of a double click (detail 2) must not confirm what the user has
  // not read: it is ignored. A single click (1) and the keyboard (0) work as usual.
  const send = (event: { detail: number }) => {
    if (event.detail > 1) return
    if (sending.current || cancel.isPending) return
    sending.current = true
    cancel.mutate()
  }

  return (
    <section aria-labelledby="cancel-devis-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 id="cancel-devis-title" className="text-lg font-semibold text-slate-900">
        {t('documents.cancelDevis.title')}
      </h2>
      <p className="mt-2 text-sm text-slate-600">{t('documents.cancelDevis.intro')}</p>

      {cancel.isError && (
        <div className="mt-3">
          <Alert kind="error">{t(errorMessageKey(cancel.error, CANCEL_ERRORS))}</Alert>
        </div>
      )}

      {!asking ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              cancel.reset()
              setAsking(true)
            }}
            className={secondaryButton}
          >
            {t('documents.cancelDevis.button')}
          </button>
        </div>
      ) : (
        <div role="group" aria-labelledby={questionId} className="mt-4 rounded-md border border-slate-300 p-4">
          <h3 id={questionId} className="text-base font-semibold text-slate-900">
            {t('documents.cancelDevis.question')}
          </h3>
          <p className="mt-2 text-sm font-medium text-slate-900">{t('documents.cancelDevis.consequence')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={cancel.isPending} onClick={send} className={dangerButton}>
              {cancel.isPending ? t('documents.cancelDevis.confirming') : t('documents.cancelDevis.confirm')}
            </button>
            <button
              type="button"
              // The keyboard lands on the safe choice.
              autoFocus
              disabled={cancel.isPending}
              onClick={() => setAsking(false)}
              className={secondaryButton}
            >
              {t('documents.cancelDevis.back')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
