import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalField } from '../../../components/DecimalField'
import { Alert, SelectField, TextField } from '../../../components/FormControls'
import { primaryButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { formatMillimes, type Millimes, MoneyRangeError, type PaymentState, paymentState } from '../../../lib/money/money'
import { todayInTunis } from '../../../lib/today'
import { canCommitDocuments, useMyRole } from '../../organizations/useMyRole'
import { documentsKey } from '../api'
import { formatDay } from '../dates'
import { PAYMENT_METHODS } from '../payload'
import { type PaymentInput, paymentSchema, type PaymentValues } from '../paymentSchema'
import { listPayments, paymentsKey, recordPayment } from '../paymentsApi'

type PaymentsPanelProps = {
  organizationId: string
  documentId: string
  status: 'sent' | 'paid'
  /** The STORED net à payer of the facture (readStoredTotals), never recomputed. */
  netAPayer: Millimes
}

// A payment that matched no document of the organization (PGRST116 from the check).
const PAYMENT_ERRORS = { PGRST116: 'documents.payments.errors.notFound' }

/** What the open confirmation was opened with: the payment, and the state it was based on. */
type Confirmed = { values: PaymentValues; before: PaymentState }

const tnd = (value: Millimes) => `${formatMillimes(value)} TND`

/**
 * The payments of an issued facture: the list, what is paid and what remains (derived by
 * paymentState(), never stored), and, while the facture is 'sent', a form to record one.
 *
 * Nothing is sent before an inline confirmation that shows the amount, the day, the method
 * and the remaining amount before and after. Like the issue confirmation, it is BOUND to
 * what it shows: if the payments change behind it (another tab recorded one), it closes and
 * says so, and the amount sent is always the one displayed. Postgres re-checks everything:
 * overpayment (DF018), a facture already paid (DF016), and sets 'paid' itself.
 */
export function PaymentsPanel({ organizationId, documentId, status, netAPayer }: PaymentsPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const questionId = useId()
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
  const [recorded, setRecorded] = useState(false)
  const sending = useRef(false)

  // R-1: only an owner or an admin records a payment (Postgres answers DF026 otherwise).
  const myRole = useMyRole(organizationId)
  const allowed = myRole.isSuccess && canCommitDocuments(myRole.data)

  const payments = useQuery({
    queryKey: paymentsKey(organizationId, documentId),
    retry: false,
    queryFn: () => listPayments(organizationId, documentId),
  })

  let state: PaymentState | null = null
  let unreadable = false
  if (payments.data) {
    try {
      state = paymentState(netAPayer, payments.data.map((payment) => payment.amount))
    } catch (error) {
      if (!(error instanceof MoneyRangeError)) throw error
      unreadable = true
    }
  }

  const remaining = state?.remaining ?? netAPayer
  const form = useForm<PaymentInput, unknown, PaymentValues>({
    resolver: zodResolver(paymentSchema(remaining)),
    defaultValues: { amount: '', paid_at: todayInTunis(), method: '' },
  })
  const errors = form.formState.errors

  const record = useMutation({
    mutationFn: (values: PaymentValues) => recordPayment(organizationId, documentId, values.amount, values.paidAt, values.method),
    onSuccess: async () => {
      setConfirmed(null)
      setRecorded(true)
      form.reset({ amount: '', paid_at: todayInTunis(), method: '' })
      // The payments, and the document: its status may now be 'paid'.
      await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
    },
    onError: async () => {
      setConfirmed(null)
      // Whatever went wrong, show what Postgres has now (DF018: another payment arrived;
      // DF016: the facture is already paid).
      await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
    },
    onSettled: () => {
      sending.current = false
    },
  })

  // The payments changed after the confirmation was opened, and no request is on its way.
  const stale = confirmed !== null && !record.isPending && (state === null || state.paid !== confirmed.before.paid)
  const open = confirmed !== null && !stale

  // The confirm button appears where the button that opened the confirmation was, or near
  // it. The second click of a double click (detail 2) must not confirm what the user has
  // not read: it is ignored. A single click (1) and the keyboard (0) work as usual.
  const send = (event: { detail: number }) => {
    if (event.detail > 1) return
    if (confirmed === null || stale || sending.current || record.isPending) return
    sending.current = true
    record.mutate(confirmed.values)
  }

  const summary: [string, string][] =
    state === null
      ? []
      : [
          [t('documents.payments.netAPayer'), tnd(netAPayer)],
          [t('documents.payments.paid'), tnd(state.paid)],
          [t('documents.payments.remaining'), tnd(state.remaining)],
        ]

  return (
    <section aria-labelledby="payments-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 id="payments-title" className="text-lg font-semibold text-slate-900">
        {t('documents.payments.title')}
      </h2>

      {payments.isPending && <p role="status" className="mt-2 text-sm text-slate-600">{t('app.loading')}</p>}
      {payments.isError && (
        <div className="mt-3">
          <Alert kind="error">{t(errorMessageKey(payments.error))}</Alert>
        </div>
      )}
      {unreadable && (
        <div className="mt-3">
          <Alert kind="error">{t('documents.payments.unreadable')}</Alert>
        </div>
      )}

      {payments.data && !unreadable && (
        <>
          {payments.data.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">{t('documents.payments.none')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 text-sm">
              {payments.data.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                  <span className="text-slate-700">
                    {formatDay(payment.paidAt)} · {t(`documents.payments.methods.${payment.method}`)}
                  </span>
                  <span className="font-medium text-slate-900">{tnd(payment.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-3 grid grid-cols-1 gap-y-1 border-t border-slate-200 pt-3 text-sm">
            {summary.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {recorded && !record.isError && (
        <div className="mt-3">
          <Alert kind="success">{t('documents.payments.recorded')}</Alert>
        </div>
      )}
      {record.isError && (
        <div className="mt-3">
          <Alert kind="error">{t(errorMessageKey(record.error, PAYMENT_ERRORS))}</Alert>
        </div>
      )}
      {stale && (
        <div className="mt-3">
          <Alert kind="error">{t('documents.payments.changedWhileConfirming')}</Alert>
        </div>
      )}

      {status === 'paid' && <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{t('documents.payments.settled')}</p>}

      {status === 'sent' && state !== null && state.remaining > 0 && myRole.isSuccess && !allowed && (
        <p role="note" className="mt-4 border-t border-slate-200 pt-4 text-sm text-slate-600">{t('documents.payments.roleNotAllowed')}</p>
      )}

      {status === 'sent' && state !== null && state.remaining > 0 && allowed && !open && (
        <form
          noValidate
          className="mt-4 border-t border-slate-200 pt-4"
          onSubmit={form.handleSubmit((values) => {
            record.reset()
            setRecorded(false)
            if (state !== null) setConfirmed({ values, before: state })
          })}
        >
          <h3 className="mb-3 text-base font-semibold text-slate-900">{t('documents.payments.formTitle')}</h3>
          <DecimalField
            control={form.control}
            name="amount"
            kind="amount"
            label={t('documents.payments.fields.amount')}
            hint={t('documents.payments.fields.amountHint', { remaining: tnd(state.remaining) })}
            errorKey={errors.amount?.message}
          />
          <TextField
            type="date"
            label={t('documents.payments.fields.paidAt')}
            errorKey={errors.paid_at?.message}
            {...form.register('paid_at')}
          />
          <SelectField label={t('documents.payments.fields.method')} errorKey={errors.method?.message} {...form.register('method')}>
            <option value="">{t('documents.payments.fields.methodChoose')}</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`documents.payments.methods.${method}`)}
              </option>
            ))}
          </SelectField>
          <button type="submit" className={primaryButton}>
            {t('documents.payments.submit')}
          </button>
        </form>
      )}

      {open && allowed && confirmed !== null && (
        <div role="group" aria-labelledby={questionId} className="mt-4 rounded-md border border-slate-300 p-4">
          <h3 id={questionId} className="text-base font-semibold text-slate-900">
            {t('documents.payments.question')}
          </h3>
          <p className="mt-2 text-sm font-medium text-slate-900">{t('documents.payments.consequence')}</p>
          <dl className="mt-3 grid grid-cols-1 gap-y-1 text-sm">
            {(
              [
                [t('documents.payments.fields.amount'), tnd(confirmed.values.amount)],
                [t('documents.payments.fields.paidAt'), formatDay(confirmed.values.paidAt)],
                [t('documents.payments.fields.method'), t(`documents.payments.methods.${confirmed.values.method}`)],
                [t('documents.payments.remainingBefore'), tnd(confirmed.before.remaining)],
                // Already checked by the form: the amount is at most the remaining amount.
                [t('documents.payments.remainingAfter'), tnd(paymentState(confirmed.before.remaining, [confirmed.values.amount]).remaining)],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={record.isPending} onClick={send} className={primaryButton}>
              {record.isPending ? t('documents.payments.confirming') : t('documents.payments.confirm')}
            </button>
            <button
              type="button"
              // The keyboard lands on the safe choice.
              autoFocus
              disabled={record.isPending}
              onClick={() => setConfirmed(null)}
              className={secondaryButton}
            >
              {t('documents.payments.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
