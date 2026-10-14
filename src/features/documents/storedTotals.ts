import { fromDbNumeric, fromDbRate, type Millimes, MoneyFormatError, MoneyRangeError, type TvaLine } from '../../lib/money/money'

// The totals STORED on an issued document, read strictly.
//
// They were written by Postgres when the document was issued (private.compute_totals()),
// and they are what the document says. This file only READS them: it never computes a
// total from the lines, never fills a missing value, never repairs a malformed one.
// Anything that is not exactly the expected form gives null, and the screen says that the
// stored totals cannot be read instead of showing a guess.
//
//   total_ht, total_tva, total_ttc, net_a_payer   text with 3 decimals ("1190.600")
//   timbre_fiscal                                 the same, or NULL when no timbre applies
//   tva_breakdown                                 [{"rate":"19.000","base":"160.000","tva":"30.400"}]
//                                                 every value a STRING, never a JSON number

/** The columns of a document this reader needs, as PostgREST returns them (amounts with ::text). */
export type StoredTotalsColumns = {
  total_ht: string | null
  total_tva: string | null
  total_ttc: string | null
  timbre_fiscal: string | null
  net_a_payer: string | null
  tva_breakdown: unknown
}

export type StoredTotals = {
  tvaLines: TvaLine[]
  totalHT: Millimes
  totalTVA: Millimes
  /** HT + TVA, never the timbre. */
  totalTTC: Millimes
  /** null: no timbre was charged. */
  timbre: Millimes | null
  netAPayer: Millimes
}

const BREAKDOWN_KEYS = ['base', 'rate', 'tva']

/** One entry of tva_breakdown: an object with exactly the three keys, each a string. */
function readTvaLine(entry: unknown): TvaLine {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new MoneyFormatError('tva_breakdown entry is not an object')
  const fields = entry as Record<string, unknown>
  const keys = Object.keys(fields).sort()
  if (keys.length !== BREAKDOWN_KEYS.length || keys.some((key, index) => key !== BREAKDOWN_KEYS[index])) {
    throw new MoneyFormatError('tva_breakdown entry does not have exactly rate, base and tva')
  }
  const { rate, base, tva } = fields
  // A JSON number here would be a float: it is refused, not converted.
  if (typeof rate !== 'string' || typeof base !== 'string' || typeof tva !== 'string') {
    throw new MoneyFormatError('tva_breakdown values must be strings')
  }
  return { rate: fromDbRate(rate), baseHT: fromDbNumeric(base), tva: fromDbNumeric(tva) }
}

/**
 * The stored totals of an issued document, or null when any of them is missing or is not
 * in the exact stored form. Never a partial result.
 */
export function readStoredTotals(columns: StoredTotalsColumns): StoredTotals | null {
  const { total_ht, total_tva, total_ttc, timbre_fiscal, net_a_payer, tva_breakdown } = columns
  if (total_ht === null || total_tva === null || total_ttc === null || net_a_payer === null) return null
  if (!Array.isArray(tva_breakdown)) return null
  try {
    return {
      tvaLines: tva_breakdown.map(readTvaLine),
      totalHT: fromDbNumeric(total_ht),
      totalTVA: fromDbNumeric(total_tva),
      totalTTC: fromDbNumeric(total_ttc),
      timbre: timbre_fiscal === null ? null : fromDbNumeric(timbre_fiscal),
      netAPayer: fromDbNumeric(net_a_payer),
    }
  } catch (error) {
    if (error instanceof MoneyFormatError || error instanceof MoneyRangeError) return null
    throw error
  }
}
