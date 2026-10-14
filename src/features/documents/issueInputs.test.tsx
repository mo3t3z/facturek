import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../lib/i18n'
import { newQueryClient, Providers, authState } from '../../test/helpers'

// What the items editor GIVES to the issue panel.
//
// On the real screen two things protect the expected total from a line still being typed:
// the panel is given the totals of the SAVED lines only, and the button is disabled while
// a line form holds input. The second hides the first: with the button disabled, nobody
// could see that the wrong totals were passed. So the panel is replaced here by a recorder,
// and the first protection is checked on its own.

const panel = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('./components/IssuePanel', () => ({
  IssuePanel: (props: Record<string, unknown>) => {
    panel.props.push(props)
    return null
  },
}))

const db = vi.hoisted(() => ({ lines: [] as unknown[], tax: null as unknown }))
vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const result = () => Promise.resolve({ data: table === 'tax_settings' ? db.tax : db.lines, error: null })
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: result,
      then: (onOk: (value: unknown) => unknown, onError: (reason: unknown) => unknown) => result().then(onOk, onError),
    }
    return query
  }
  return { supabase: { from } }
})

import { ItemsEditor } from './components/ItemsEditor'

const user = userEvent.setup({ delay: null })
const DOC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const last = () => panel.props.at(-1) as { totals: { netAPayer: number; totalHT: number } | null; lineFormBusy: boolean; lineCount: number; taxSettings: string }

beforeEach(() => {
  panel.props.length = 0
  // 2 x 10.000 at 19 %: HT 20.000, TVA 3.800, TTC 23.800; timbre 1.000: net à payer 24.800.
  db.lines = [{ id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', position: 0, description: 'Installation', quantity: '2.000', unit_price: '10.000', tva_rate: '19.000' }]
  db.tax = { organization_id: 'org-1', default_tva_rate: '19.000', timbre_enabled: true, timbre_fiscal: '1.000' }
})

function open(type: 'facture' | 'devis' = 'facture') {
  return render(
    <Providers auth={authState()} client={newQueryClient()}>
      <ItemsEditor organizationId="org-1" documentId={DOC} documentType={type} editable hasClient headerDirty={false} />
    </Providers>,
  )
}

describe('what the items editor gives to the issue panel', () => {
  it('the totals of the saved lines with the current tax settings', async () => {
    open()
    await waitFor(() => expect(last()?.taxSettings).toBe('ready'))
    expect(last()).toMatchObject({ lineCount: 1, lineFormBusy: false, totals: { totalHT: 20000, netAPayer: 24800 } })
  })

  it('no timbre for a devis', async () => {
    open('devis')
    await waitFor(() => expect(last()?.taxSettings).toBe('ready'))
    expect(last().totals).toMatchObject({ netAPayer: 23800 })
  })

  it('STILL the totals of the saved lines while a complete new line is being typed, and it says a form is busy', async () => {
    open()
    const form = await screen.findByRole('form', { name: 'Ajouter une ligne' })
    await user.type(within(form).getByLabelText('Désignation'), 'En cours')
    await user.type(within(form).getByLabelText('Quantité'), '2')
    await user.type(within(form).getByLabelText('Prix unitaire HT (TND)'), '50')
    // The preview counts the typed line: 20 + 100 = 120.000 HT, 142.800 TTC, 143.800 net.
    const preview = screen.getByRole('region', { name: /^Totaux/ })
    await waitFor(() => expect(within(preview).getByText('Net à payer', { selector: 'dt' }).nextElementSibling).toHaveTextContent('143,800 TND'))
    // The issue panel does not: it is given what is SAVED.
    expect(last()).toMatchObject({ lineFormBusy: true, lineCount: 1, totals: { totalHT: 20000, netAPayer: 24800 } })
  })

  it('the totals of the saved lines while a saved line is being edited to another amount', async () => {
    open()
    await user.click(await screen.findByRole('button', { name: /^Modifier la ligne 1 :/ }))
    const form = screen.getByRole('form', { name: /Modifier la ligne 1/ })
    await user.clear(within(form).getByLabelText('Prix unitaire HT (TND)'))
    await user.type(within(form).getByLabelText('Prix unitaire HT (TND)'), '500')
    await waitFor(() => expect(last().lineFormBusy).toBe(true))
    expect(last().totals).toMatchObject({ totalHT: 20000, netAPayer: 24800 })
  })
})
