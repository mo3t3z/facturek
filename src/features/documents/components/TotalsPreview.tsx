import { useTranslation } from 'react-i18next'
import type { Totals } from '../../../lib/money/money'
import type { PendingLine, PreviewTimbre } from '../preview'
import { TotalsTable } from './TotalsTable'

type TotalsPreviewProps = {
  /** From computeTotals(); null when an amount exceeds the largest possible value. */
  totals: Totals | null
  timbre: PreviewTimbre
  pending: PendingLine['state']
}

// Displays the totals PREVIEW of a draft: what computeTotals() returned for the saved lines
// plus the line being typed, shown by TotalsTable. There is no arithmetic in this
// component, and nothing shown here is saved.
// TODO(accountant): rounding rule, scope of the timbre fiscal, retenue à la source not handled.
export function TotalsPreview({ totals, timbre, pending }: TotalsPreviewProps) {
  const { t } = useTranslation()

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
        <TotalsTable
          tvaLines={totals.tvaLines}
          totalHT={totals.totalHT}
          totalTVA={totals.totalTVA}
          totalTTC={totals.totalTTC}
          timbre={totals.timbre}
          netAPayer={totals.netAPayer}
        />
      )}
    </section>
  )
}
