import { useTranslation } from 'react-i18next'
import { formatMillimes, formatRate, type Totals } from '../../../lib/money/money'
import type { PendingLine, PreviewTimbre } from '../preview'

type TotalsPreviewProps = {
  /** From computeTotals(); null when an amount exceeds the largest possible value. */
  totals: Totals | null
  timbre: PreviewTimbre
  pending: PendingLine['state']
}

// Displays the totals PREVIEW of a draft. It only formats what computeTotals() returned:
// there is no arithmetic in this component, and nothing shown here is saved.
// TODO(accountant): rounding rule, scope of the timbre fiscal, retenue à la source not handled.
export function TotalsPreview({ totals, timbre, pending }: TotalsPreviewProps) {
  const { t } = useTranslation()
  const amount = (value: Parameters<typeof formatMillimes>[0]) => t('money.amount', { value: formatMillimes(value) })

  return (
    <section aria-labelledby="totals-preview-title" className="mt-6 rounded-lg border border-amber-300 bg-white p-4 shadow-sm sm:p-6">
      <h2 id="totals-preview-title" className="text-lg font-semibold text-slate-900">
        {t('documents.preview.title')}{' '}
        <span className="ms-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900">{t('documents.preview.unsaved')}</span>
      </h2>
      <p className="mt-2 text-sm text-slate-600">{t('documents.preview.explanation')}</p>
      <p role="note" className="mt-1 text-sm text-slate-600">
        {t('documents.preview.accountant')}
      </p>

      {pending === 'complete' && (
        <p role="status" className="mt-3 text-sm text-slate-700">
          {t('documents.preview.pendingIncluded')}
        </p>
      )}
      {pending === 'incomplete' && (
        <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('documents.preview.pendingIgnored')}
        </p>
      )}
      {timbre.state === 'missing' && (
        <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('documents.preview.timbreMissing')}
        </p>
      )}

      {totals === null ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t('documents.preview.overflow')}
        </p>
      ) : (
        <>
          {totals.tvaLines.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <caption className="mb-1 text-start font-medium text-slate-700">{t('documents.preview.byRate')}</caption>
              <thead>
                <tr className="text-slate-500">
                  <th scope="col" className="py-1 text-start font-medium">
                    {t('documents.preview.rate')}
                  </th>
                  <th scope="col" className="py-1 text-end font-medium">
                    {t('documents.preview.base')}
                  </th>
                  <th scope="col" className="py-1 text-end font-medium">
                    {t('documents.preview.tva')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.tvaLines.map((line) => (
                  <tr key={line.rate} className="border-t border-slate-200 text-slate-900">
                    <th scope="row" className="py-1 text-start font-normal">
                      {t('money.rate', { value: formatRate(line.rate) })}
                    </th>
                    <td className="py-1 text-end">{amount(line.baseHT)}</td>
                    <td className="py-1 text-end">{amount(line.tva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-600">{t('documents.preview.totalHT')}</dt>
            <dd className="text-end text-slate-900">{amount(totals.totalHT)}</dd>
            <dt className="text-slate-600">{t('documents.preview.totalTVA')}</dt>
            <dd className="text-end text-slate-900">{amount(totals.totalTVA)}</dd>
            {/* HT + TVA, never the timbre. */}
            <dt className="text-slate-600">{t('documents.preview.totalTTC')}</dt>
            <dd className="text-end text-slate-900">{amount(totals.totalTTC)}</dd>
            {/* Only when computeTotals() was given a timbre: a facture of an organization that applies it. */}
            {totals.timbre !== null && (
              <>
                <dt className="text-slate-600">{t('documents.preview.timbre')}</dt>
                <dd className="text-end text-slate-900">{amount(totals.timbre)}</dd>
              </>
            )}
            {/* Total TTC + timbre: equal to the total TTC when no timbre applies. */}
            <dt className="border-t border-slate-300 pt-1 text-base font-semibold text-slate-900">{t('documents.preview.netAPayer')}</dt>
            <dd className="border-t border-slate-300 pt-1 text-end text-base font-semibold text-slate-900">{amount(totals.netAPayer)}</dd>
          </dl>
        </>
      )}
    </section>
  )
}
