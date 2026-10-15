import { useTranslation } from 'react-i18next'
import { Alert, TextLink } from '../../../components/FormControls'
import type { DocumentDetail } from '../api'
import { formatDay } from '../dates'
import { formatDocumentNumber, statusKey, typeKey } from '../format'
import { readStoredTotals } from '../storedTotals'
import { CancelDevisPanel } from './CancelDevisPanel'
import { ItemsEditor } from './ItemsEditor'
import { PaymentsPanel } from './PaymentsPanel'
import { TotalsTable } from './TotalsTable'

type IssuedDocumentProps = {
  organizationId: string
  document: DocumentDetail
}

type PartyProps = {
  titleId: string
  title: string
  name: string | null
  matricule: string | null
  address: string | null
}

/** The seller or the buyer, as printed on the document when it was issued. */
function Party({ titleId, title, name, matricule, address }: PartyProps) {
  const { t } = useTranslation()
  const none = t('documents.columns.noValue')
  const rows: [string, string | null][] = [
    [t('documents.issued.name'), name],
    [t('documents.issued.matricule'), matricule],
    [t('documents.issued.address'), address],
  ]
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <h2 id={titleId} className="mb-2 text-base font-semibold text-slate-900">
        {title}
      </h2>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium text-slate-500">{label}</dt>
            {/* User-provided text (snapshot), rendered as text only. Line breaks are kept. */}
            <dd className="whitespace-pre-line break-words text-slate-900">{value ?? none}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * An issued document, read-only.
 *
 * Everything shown here is what was STORED on the document when it was issued: its number,
 * its dates, the seller and the buyer as they were then (snapshot columns, not the current
 * organization or client), its lines, and its totals. The totals come from the stored
 * columns through readStoredTotals(); they are never recomputed from the lines. If they
 * cannot be read, the screen says so and shows no amount.
 *
 * Below the totals: the payments of a facture (PaymentsPanel, from the STORED net à payer)
 * and, on a sent devis, "Annuler le devis" (CancelDevisPanel). No PDF, no print.
 * TODO(accountant): the number format; the net à payer is before any retenue à la source.
 */
export function IssuedDocument({ organizationId, document }: IssuedDocumentProps) {
  const { t } = useTranslation()
  const none = t('documents.columns.noValue')
  const totals = readStoredTotals(document)
  // Dates are calendar days kept as plain "YYYY-MM-DD" text: formatDay only reorders them.
  const facts: [string, string][] = [
    [t('documents.columns.number'), formatDocumentNumber(document.year, document.number) ?? none],
    [t('documents.issued.type'), t(typeKey(document.type))],
    [t('documents.columns.status'), t(statusKey(document.type, document.status))],
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

      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-3 sm:p-6">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium text-slate-500">{label}</dt>
            <dd className="text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <Party
          titleId="issued-seller-title"
          title={t('documents.issued.seller')}
          name={document.seller_name}
          matricule={document.seller_matricule_fiscal}
          address={document.seller_address}
        />
        <Party
          titleId="issued-buyer-title"
          title={t('documents.issued.buyer')}
          name={document.buyer_name}
          matricule={document.buyer_matricule_fiscal}
          address={document.buyer_address}
        />
      </div>

      {/* The same list as on a draft, without any form: nothing can be changed. */}
      <ItemsEditor
        organizationId={organizationId}
        documentId={document.id}
        documentType={document.type}
        editable={false}
        hasClient={document.client_id !== null}
        headerDirty={false}
      />

      <section aria-labelledby="issued-totals-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 id="issued-totals-title" className="text-lg font-semibold text-slate-900">
          {t('documents.issued.totalsTitle')}
        </h2>
        {totals === null ? (
          <div className="mt-3">
            <Alert kind="error">{t('documents.issued.totalsError')}</Alert>
          </div>
        ) : (
          <>
            <TotalsTable
              tvaLines={totals.tvaLines}
              totalHT={totals.totalHT}
              totalTVA={totals.totalTVA}
              totalTTC={totals.totalTTC}
              timbre={totals.timbre}
              netAPayer={totals.netAPayer}
            />
            <p role="note" className="mt-3 text-sm text-slate-600">
              {t('documents.issued.retenueNote')}
            </p>
          </>
        )}
      </section>

      {document.type === 'facture' && totals !== null && (document.status === 'sent' || document.status === 'paid') && (
        <PaymentsPanel organizationId={organizationId} documentId={document.id} status={document.status} netAPayer={totals.netAPayer} />
      )}

      {document.type === 'devis' && document.status === 'sent' && <CancelDevisPanel organizationId={organizationId} devisId={document.id} />}

      {document.notes !== null && (
        <section aria-labelledby="issued-notes-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:p-6">
          <h2 id="issued-notes-title" className="mb-2 text-lg font-semibold text-slate-900">
            {t('documents.issued.notes')}
          </h2>
          {/* User-provided text, rendered as text only (never as HTML). Line breaks are kept. */}
          <p className="whitespace-pre-line break-words text-slate-900">{document.notes}</p>
        </section>
      )}

      <div className="mt-6">
        <TextLink to="/app/documents">{t('documents.backToList')}</TextLink>
      </div>
    </>
  )
}
