import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canCommitDocuments, useMyRole } from '../../organizations/useMyRole'
import { Alert, TextLink } from '../../../components/FormControls'
import { primaryButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import type { Totals } from '../../../lib/money/money'
import { getOrganizationDetails, organizationDetailsKey, taxSettingsKey } from '../../settings/api'
import { documentsKey, finalizeDocument } from '../api'
import { itemsKey } from '../itemsApi'
import type { PreviewTimbre } from '../preview'
import type { DocumentType } from '../schemas'
import { TotalsTable } from './TotalsTable'

type IssuePanelProps = {
  organizationId: string
  documentId: string
  documentType: DocumentType
  /** The SAVED document has a client. */
  hasClient: boolean
  /** Number of SAVED lines. */
  lineCount: number
  /**
   * computeTotals() on the SAVED lines and the current tax settings: never a line still
   * being typed. null when an amount exceeds the largest possible value.
   */
  totals: Totals | null
  timbre: PreviewTimbre
  taxSettings: 'loading' | 'error' | 'ready'
  /** A line form is open with something typed in it, or a line is being edited. */
  lineFormBusy: boolean
  /** The header form (client, dates, notes) has changes that are not saved. */
  headerDirty: boolean
}

// What each refusal of finalize_document means on THIS screen. Every other code keeps its
// generic text from errors.db (DF003 to DF008, DF022, DF023): nothing is shown raw.
const ISSUE_ERRORS = {
  DF009: 'documents.issue.errors.totalsChanged',
  DF002: 'documents.issue.errors.alreadyIssued',
  DF001: 'documents.issue.errors.missing',
  PGRST116: 'documents.issue.errors.missing',
}

const codeOf = (error: unknown) => (typeof error === 'object' && error !== null && 'code' in error ? error.code : null)

/** Two results of computeTotals() show the same amounts (integers only: no arithmetic). */
const sameTotals = (a: Totals, b: Totals) =>
  a.totalHT === b.totalHT &&
  a.totalTVA === b.totalTVA &&
  a.totalTTC === b.totalTTC &&
  a.timbre === b.timbre &&
  a.netAPayer === b.netAPayer &&
  a.tvaLines.length === b.tvaLines.length &&
  a.tvaLines.every((line, index) => line.rate === b.tvaLines[index]?.rate && line.baseHT === b.tvaLines[index]?.baseHT && line.tva === b.tvaLines[index]?.tva)

/**
 * "Émettre" on a draft: the button, the reasons why it is disabled, and the confirmation.
 *
 * Issuing cannot be undone: the document gets its number and is frozen. So nothing is sent
 * before an explicit confirmation that shows the totals of what will be issued.
 *
 * The amount sent as the expected total is the net à payer computed by computeTotals() from
 * the saved lines AT THE MOMENT THE CONFIRMATION WAS OPENED: exactly the amount written in
 * it. Postgres recomputes it from the lines it has and refuses to issue if the two differ
 * (DF009). The disabled button is a convenience: Postgres is the authority and re-checks
 * every rule (client, lines, dates, timbre, totals).
 *
 * The lines can be reloaded behind an open confirmation (another tab changed them and this
 * one got the focus back). The confirmation is therefore bound to the totals it was opened
 * with: if they are no longer the totals of the screen, it closes and says so. It never
 * swaps its amounts in place, which could issue an amount the user did not read.
 *
 * TODO(accountant): whether a facture without the seller's matricule fiscal or address is
 * valid. For now both are warnings in the confirmation, and nothing is blocked.
 */
export function IssuePanel(props: IssuePanelProps) {
  const { organizationId, documentId, documentType, totals, timbre } = props
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const myRole = useMyRole(organizationId)
  const reasonsId = useId()
  const questionId = useId()
  // The totals the open confirmation was opened with (null: no confirmation is open).
  const [confirmed, setConfirmed] = useState<Totals | null>(null)
  // A second click can arrive before React has rendered the disabled button.
  const sending = useRef(false)

  // The seller identity that will be copied onto the document. Only read to warn.
  const organization = useQuery({
    queryKey: organizationDetailsKey(organizationId),
    retry: false,
    queryFn: () => getOrganizationDetails(organizationId),
  })

  const issue = useMutation({
    mutationFn: (expected: Totals['netAPayer']) => finalizeDocument(organizationId, documentId, expected),
    onSuccess: async () => {
      // The list, this document and its lines: all three live under documentsKey. The page
      // then receives a document that is no longer a draft and shows the issued view.
      await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
    },
    onError: async (error) => {
      setConfirmed(null)
      const code = codeOf(error)
      if (code === 'DF009') {
        // The total the user confirmed is not the total of the stored document: something
        // changed elsewhere. Load what Postgres has, so the screen shows the real total.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: itemsKey(organizationId, documentId) }),
          queryClient.invalidateQueries({ queryKey: taxSettingsKey(organizationId) }),
        ])
      } else if (code === 'DF002' || code === 'DF001' || code === 'PGRST116') {
        // Already issued, or gone: reload the document, the page shows what it is now.
        await queryClient.invalidateQueries({ queryKey: documentsKey(organizationId) })
      }
    },
    onSettled: () => {
      sending.current = false
    },
  })

  // The refusal of the last attempt describes the draft as it was then. Once the user edits
  // the header or a line it may no longer be true (a date fixed after DF006), so it goes.
  const resetIssue = issue.reset
  const editing = props.headerDirty || props.lineFormBusy
  useEffect(() => {
    if (editing) resetIssue()
  }, [editing, resetIssue])

  // Why the document cannot be issued yet, in the order the user would fix them.
  // The role comes first: nothing else matters to a member (R-1; Postgres answers DF026).
  const reasons: string[] = []
  if (myRole.isPending) reasons.push('documents.issue.blocked.roleLoading')
  else if (myRole.isError) reasons.push('documents.issue.blocked.roleError')
  else if (!canCommitDocuments(myRole.data)) reasons.push('documents.issue.blocked.role')
  if (!props.hasClient) reasons.push('documents.issue.blocked.noClient')
  if (props.lineCount === 0) reasons.push('documents.issue.blocked.noLines')
  if (props.headerDirty) reasons.push('documents.issue.blocked.header')
  if (props.lineFormBusy) reasons.push('documents.issue.blocked.lineForm')
  if (props.taxSettings === 'loading') reasons.push('documents.issue.blocked.taxLoading')
  if (props.taxSettings === 'error') reasons.push('documents.issue.blocked.taxError')
  if (props.taxSettings === 'ready') {
    if (timbre.state === 'missing') reasons.push('documents.issue.blocked.timbreMissing')
    if (totals === null) reasons.push('documents.issue.blocked.overflow')
    // Compared with zero only: no arithmetic here. Postgres refuses it too (DF022).
    else if (props.lineCount > 0 && totals.totalTTC === 0) reasons.push('documents.issue.blocked.zeroTotal')
  }
  const blocked = reasons.length > 0 || totals === null
  // The totals changed after the confirmation was opened, and no request is on its way.
  const stale = confirmed !== null && !issue.isPending && (totals === null || !sameTotals(confirmed, totals))
  // The confirmation never stays open over something that changed under it.
  const open = confirmed !== null && !blocked && !stale

  // The confirm button appears where the button that opened the confirmation was, or near
  // it. The second click of a double click (detail 2) must not confirm what the user has
  // not read: it is ignored. A single click (1) and the keyboard (0) work as usual.
  const send = (event: { detail: number }) => {
    if (event.detail > 1) return
    if (confirmed === null || blocked || stale || sending.current || issue.isPending) return
    sending.current = true
    // The amount the user is looking at, not whatever the screen has computed since.
    issue.mutate(confirmed.netAPayer)
  }

  const seller = organization.data
  const warnings: string[] = []
  if (seller && !seller.matricule_fiscal) warnings.push('documents.issue.warnings.sellerMatricule')
  if (seller && !seller.address) warnings.push('documents.issue.warnings.sellerAddress')

  return (
    <section aria-labelledby="issue-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 id="issue-title" className="text-lg font-semibold text-slate-900">
        {t('documents.issue.title')}
      </h2>
      <p className="mt-2 text-sm text-slate-600">{t('documents.issue.intro')}</p>

      {issue.isError && (
        <div className="mt-3">
          <Alert kind="error">{t(errorMessageKey(issue.error, ISSUE_ERRORS))}</Alert>
        </div>
      )}

      {stale && (
        <div className="mt-3">
          <Alert kind="error">{t('documents.issue.errors.changedWhileConfirming')}</Alert>
        </div>
      )}

      {reasons.length > 0 && (
        <div id={reasonsId} role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">{t('documents.issue.blockedTitle')}</p>
          <ul className="mt-1 list-disc ps-5">
            {reasons.map((reason) => (
              <li key={reason}>{t(reason)}</li>
            ))}
          </ul>
        </div>
      )}

      {!open && (
        <div className="mt-3">
          <button
            type="button"
            disabled={blocked || issue.isPending}
            aria-describedby={reasons.length > 0 ? reasonsId : undefined}
            onClick={() => {
              issue.reset()
              setConfirmed(totals)
            }}
            className={primaryButton}
          >
            {t(`documents.issue.button.${documentType}`)}
          </button>
        </div>
      )}

      {open && confirmed !== null && (
        <div role="group" aria-labelledby={questionId} className="mt-4 rounded-md border border-slate-300 p-4">
          <h3 id={questionId} className="text-base font-semibold text-slate-900">
            {t(`documents.issue.question.${documentType}`)}
          </h3>
          <p className="mt-2 text-sm font-medium text-slate-900">{t('documents.issue.consequence')}</p>

          <p className="mt-4 text-sm font-medium text-slate-700">{t('documents.issue.totalsTitle')}</p>
          <TotalsTable
            tvaLines={confirmed.tvaLines}
            totalHT={confirmed.totalHT}
            totalTVA={confirmed.totalTVA}
            totalTTC={confirmed.totalTTC}
            timbre={confirmed.timbre}
            netAPayer={confirmed.netAPayer}
          />

          {warnings.length > 0 && (
            <div role="note" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <ul className="list-disc ps-5">
                {warnings.map((warning) => (
                  <li key={warning}>{t(warning)}</li>
                ))}
              </ul>
              <p className="mt-1">{t('documents.issue.warnings.accountant')}</p>
              <div className="mt-1">
                <TextLink to="/app/settings">{t('documents.issue.warnings.settingsLink')}</TextLink>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={issue.isPending} onClick={send} className={primaryButton}>
              {issue.isPending ? t('documents.issue.confirming') : t('documents.issue.confirm')}
            </button>
            <button
              type="button"
              // The keyboard lands on the safe choice.
              autoFocus
              disabled={issue.isPending}
              onClick={() => setConfirmed(null)}
              className={secondaryButton}
            >
              {t('documents.issue.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
