import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { errorMessageKey } from '../../../lib/errors'
import { useOrganization } from '../../organizations/useOrganization'
import { clientsKey, createClient } from '../api'
import { ClientForm } from '../components/ClientForm'
import type { ClientValues } from '../schemas'

const EMPTY: ClientValues = { name: '', matricule_fiscal: '', address: '', email: '', phone: '' }

export function ClientCreatePage() {
  const { t } = useTranslation()
  const organization = useOrganization()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const create = useMutation({
    mutationFn: (values: ClientValues) => createClient(organization.id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientsKey(organization.id) })
      await navigate('/app/clients')
    },
  })

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t('clients.create.title')}</h1>
      <ClientForm
        defaultValues={EMPTY}
        onSubmit={(values) => create.mutate(values)}
        pending={create.isPending}
        errorKey={create.isError ? errorMessageKey(create.error) : null}
        submitLabel={t('clients.create.submit')}
        pendingLabel={t('clients.create.submitting')}
      />
    </>
  )
}
