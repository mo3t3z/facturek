import { computeTotals, type Line, lineTotalHT, type Millimes, MoneyRangeError, type Totals } from '../../lib/money/money'
import type { TaxSettings } from '../settings/api'
import type { DocumentType } from './schemas'

// The totals PREVIEW of a draft. Nothing here is stored: the totals of an issued document
// will be computed and saved by Postgres when it is finalized.
// Every amount comes from computeTotals() of src/lib/money: this file only decides WHICH
// lines and WHICH timbre are given to it. It contains no arithmetic.
//
// TODO(accountant): the rounding rule (line rounded half-up, TVA rounded once per rate),
// the scope of the timbre fiscal (factures only, added after TVA, not subject to it) and
// the retenue à la source (NOT handled at all here) must be verified before real use.

export type PreviewTimbre =
  /** A devis, or the organization does not apply the timbre. */
  | { state: 'none' }
  /** A facture, timbre applied, but no amount entered in the settings (finalize would refuse: DF007). */
  | { state: 'missing' }
  | { state: 'applied'; amount: Millimes }

/** The timbre fiscal is charged on factures only, never on a devis. */
export function previewTimbre(type: DocumentType, settings: Pick<TaxSettings, 'timbreEnabled' | 'timbreFiscal'>): PreviewTimbre {
  if (type !== 'facture' || !settings.timbreEnabled) return { state: 'none' }
  if (settings.timbreFiscal === null) return { state: 'missing' }
  return { state: 'applied', amount: settings.timbreFiscal }
}

/** null when a total exceeds what numeric(12,3) can hold: the screen says so instead of showing a number. */
export function previewTotals(lines: readonly Line[], timbre: PreviewTimbre): Totals | null {
  try {
    return computeTotals({ lines, timbre: timbre.state === 'applied' ? timbre.amount : null })
  } catch (error) {
    if (error instanceof MoneyRangeError) return null
    throw error
  }
}

/** The line being typed in a form: counted when complete, ignored (and reported) when not. */
export type PendingLine =
  /** No form has anything typed in it. */
  | { state: 'none' }
  /** The form holds a line that cannot be read yet. */
  | { state: 'incomplete'; replaces: string | null }
  /** `replaces` is the id of the saved line being edited, or null for a new line. */
  | { state: 'complete'; replaces: string | null; line: Line }

/**
 * The lines the preview counts: the saved lines, with the one being edited replaced by
 * what is typed, plus the new line being typed. An incomplete edit keeps the saved values
 * of that line; an incomplete new line is simply not counted.
 */
export function previewLines<Saved extends Line & { id: string }>(saved: readonly Saved[], pending: PendingLine): Line[] {
  if (pending.state !== 'complete') return [...saved]
  if (pending.replaces === null) return [...saved, pending.line]
  return saved.map((line) => (line.id === pending.replaces ? pending.line : line))
}

/** The total HT of one line, or null when it exceeds what numeric(12,3) can hold. */
export function previewLineTotal(line: Pick<Line, 'quantity' | 'unitPrice'>): Millimes | null {
  try {
    return lineTotalHT(line.quantity, line.unitPrice)
  } catch (error) {
    if (error instanceof MoneyRangeError) return null
    throw error
  }
}
