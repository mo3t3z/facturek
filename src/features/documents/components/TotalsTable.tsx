import { useTranslation } from 'react-i18next'
import { formatMillimes, formatRate, type Millimes, type TvaLine } from '../../../lib/money/money'

export type TotalsTableProps = {
  /** One entry per rate, sorted by rate. Empty: the table is not shown. */
  tvaLines: readonly TvaLine[]
  totalHT: Millimes
  totalTVA: Millimes
  /** HT + TVA, never the timbre. */
  totalTTC: Millimes
  /** null: no timbre applies, and its row is not shown. */
  timbre: Millimes | null
  /** Total TTC + timbre. */
  netAPayer: Millimes
}

// The totals of a document, always in the same order and with the same labels: TVA by
// rate, then Total HT, TVA, Total TTC, Droit de timbre (when one applies), Net à payer.
// It only FORMATS the amounts it is given: there is no arithmetic here. The caller says
// where they come from (computeTotals() for a draft, the stored columns once issued).
export function TotalsTable({ tvaLines, totalHT, totalTVA, totalTTC, timbre, netAPayer }: TotalsTableProps) {
  const { t } = useTranslation()
  const amount = (value: Millimes) => t('money.amount', { value: formatMillimes(value) })

  return (
    <>
      {tvaLines.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <caption className="mb-1 text-start font-medium text-slate-700">{t('documents.totals.byRate')}</caption>
          <thead>
            <tr className="text-slate-500">
              <th scope="col" className="py-1 text-start font-medium">
                {t('documents.totals.rate')}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t('documents.totals.base')}
              </th>
              <th scope="col" className="py-1 text-end font-medium">
                {t('documents.totals.tva')}
              </th>
            </tr>
          </thead>
          <tbody>
            {tvaLines.map((line) => (
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
        <dt className="text-slate-600">{t('documents.totals.totalHT')}</dt>
        <dd className="text-end text-slate-900">{amount(totalHT)}</dd>
        <dt className="text-slate-600">{t('documents.totals.totalTVA')}</dt>
        <dd className="text-end text-slate-900">{amount(totalTVA)}</dd>
        {/* HT + TVA, never the timbre. */}
        <dt className="text-slate-600">{t('documents.totals.totalTTC')}</dt>
        <dd className="text-end text-slate-900">{amount(totalTTC)}</dd>
        {/* Only when a timbre applies: a facture of an organization that charges it. */}
        {timbre !== null && (
          <>
            <dt className="text-slate-600">{t('documents.totals.timbre')}</dt>
            <dd className="text-end text-slate-900">{amount(timbre)}</dd>
          </>
        )}
        {/* Total TTC + timbre: equal to the total TTC when no timbre applies. */}
        <dt className="border-t border-slate-300 pt-1 text-base font-semibold text-slate-900">{t('documents.totals.netAPayer')}</dt>
        <dd className="border-t border-slate-300 pt-1 text-end text-base font-semibold text-slate-900">{amount(netAPayer)}</dd>
      </dl>
    </>
  )
}
