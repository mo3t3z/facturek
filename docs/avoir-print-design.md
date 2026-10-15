# Design draft: credit notes (avoirs) and printable documents (docs only)

Written 2026-10-15 on `checkpoint/avoir-print-design` from `main` (`bb00017`). Nothing here
is built and nothing may be built from Part A or the mandatory mentions of Part B before
the accountant answers the questions of Part C. The proposals below are engineering
options, NOT statements about Tunisian law: every legal point is a question.

Sources: the local database (catalog queries), `CLAUDE.md`, `docs/STATUS.md`.

---

## Part A. Avoir (credit note)

### A1. Why it is needed (facts of the code today)

- An issued facture is frozen for every role (`guard_documents`, DF011) and can never be
  cancelled (`sent -> cancelled` is allowed for a devis only, DF012). Payments are
  append-only (DF017).
- So today there is NO way to correct a facture issued with a wrong amount, a wrong client,
  or a cancelled sale. `STATUS.md` lists this as a known limit.
- `document_type` is `{devis, facture}`; `document_counters` numbers per
  `(organization_id, type, year)`; `finalize_document()` is the only numbering path.

### A2. Options

| | Option 1: a new type `avoir` | Option 2: a facture with negative lines |
|---|---|---|
| Model | `document_type` gets `avoir`; an avoir has `corrects` -> the facture it corrects | Same type, amounts below zero |
| Numbering | Its own series per year (`avoir`, through the existing counter key) | Shares the facture series |
| Totals | Stored positive, its meaning is "credit" | Every CHECK `>= 0` and the money module (no negatives today) change |
| Risk | Additive: nothing existing changes | Touches every amount rule already tested |

**Proposal: option 1**, a separate type with its own series, amounts stored positive.
It reuses `finalize_document()` (numbering, snapshots, stored totals, DF009) almost as is,
and changes no existing rule. To confirm with the accountant (C1 to C3).

### A3. Proposed rules (to confirm)

1. An avoir is created from ONE issued facture (`sent` or `paid`), as a draft, like the
   conversion of P2f: same client, lines copied, editable before issuing.
2. Total or partial: the sum of the avoirs of a facture never exceeds its net à payer
   (same idea as DF018, a trigger for every role).
3. Issuing an avoir freezes it like a facture; it gets a number in the avoir series.
4. Effect on payments: an avoir lowers what the client owes. A facture whose payments plus
   avoirs cover the net à payer counts as settled; a refund of money already paid would be
   a separate negative movement (not designed: C6).
5. The facture itself is never modified: its status stays, the screens show "Avoir n° X"
   next to it.
6. The timbre fiscal on an avoir: unknown (C4). Nothing assumed.
7. DF009-like binding: the confirmation of an avoir is bound to its displayed totals, like
   every irreversible confirmation.

### A4. What could be built before the answers

Nothing that is issued. At most a design spike on a branch that is never merged.

---

## Part B. Printable document (document de présentation)

### B1. What exists

- The issued view (`IssuedDocument`) already shows only stored columns: number, dates,
  seller and buyer snapshots, lines, stored totals. It is the natural source of a print.
- Line totals of an issued document are DERIVED (decision I-3), not stored.

### B2. Options

| | Browser print (CSS `@media print`) | Generated PDF |
|---|---|---|
| Work | A print stylesheet and a "print" view of the issued document | A PDF library (new dependency) or a server function |
| Output | What the browser prints, "Save as PDF" included | The same file for everyone |
| Risk | Rendering differs a little between browsers | A dependency to maintain; on the server, a new component to secure |

**Proposal: browser print first** (no dependency, no server), a dedicated print view of an
issued document built ONLY from stored columns, never recomputed. A generated PDF later if
the accountant or TTN requires a fixed file.

### B3. What could be built before the answers

- The print layout itself, from the fields that exist (it is presentation only).
- But it must not be offered to users as the official document before C7 to C11 are
  answered: it would print a document whose mandatory mentions may be missing.
- If C10 says line totals must be printed exactly as stored, a migration storing them
  comes first (today they are derived).

---

## Part C. Questions for the accountant

Ready to send. Each answer decides a part of the design; none is assumed in the code.

**Avoirs**
- C1. Is a credit note (avoir / facture d'avoir) the right way to correct or cancel an
  issued facture? Is there any other allowed way?
- C2. Must avoirs have their own numbering series, or share the facture series? What
  format should their number have?
- C3. Must an avoir always reference the facture it corrects? Can one avoir correct
  several factures?
- C4. Does an avoir carry the droit de timbre? Is the timbre of the corrected facture
  given back?
- C5. Is a partial avoir allowed (part of the lines or part of an amount)?
- C6. When the client already paid, how is the refund recorded (and is it the same
  document)?

**Printed facture / devis**
- C7. Which mentions are mandatory on a facture (seller and buyer matricule fiscal,
  addresses, registre de commerce, legal form, capital, bank details...)?
  Today only the seller NAME is required to issue.
- C8. Which of them are mandatory on a devis?
- C9. Is the number format `2026-0001` acceptable? Must the type appear in it?
- C10. Must each line show its total HT, its TVA, its total TTC? Rounded how?
- C11. Must the amount be written in words ("arrêtée la présente facture à la somme de...")?
- C12. Is a printed (or PDF) copy from the browser acceptable, or is a signed electronic
  document (El Fatoora / TEIF) required for our users? (Links to the TTN questions of
  `STATUS.md`.)

---

## Part D. Order once answered

1. Avoir design approved (this note updated with the answers), then the same split as P2e:
   database, plumbing, screens, each merged on its own.
2. Print: mandatory mentions as columns or settings if missing (C7), stored line totals
   if required (C10), then the print view.
