import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { Alert, TextLink } from '../../../components/FormControls'
import { errorMessageKey } from '../../../lib/errors'
import { useOrganization } from '../../organizations/useOrganization'
import { clientsKey, getClient, updateClient } from '../api'
import { ClientForm } from '../components/ClientForm'
import { clientIdSchema, type ClientValues } from '../schemas'

// PGRST116 = "no row": the client was deleted while the form was open.
const UPDATE_ERRORS = { PGRST116: 'clients.notFound' }

export function ClientEditPage() {
  const { t } = useTranslation()
  const organization = useOrganization()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // The id comes from the URL: anything that is not a uuid is simply "not found" and is
  // never sent to the database.
  const parsedId = clientIdSchema.safeParse(useParams().clientId)
  const clientId = parsedId.success ? parsedId.data : null

  const client = useQuery({
    queryKey: [...clientsKey(organization.id), clientId],
    enabled: clientId !== null,
    // The form is filled once, when it mounts: it must get the stored values, not a cached copy.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: () => getClient(organization.id, clientId ?? ''),
  })

  const update = useMutation({
    mutationFn: (values: ClientValues) => updateClient(organization.id, clientId ?? '', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientsKey(organization.id) })
      await navigate('/app/clients')
    },
  })

  const notFound = clientId === null || (client.isSuccess && client.data === null)

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{t('clients.update.title')}</h1>
      {notFound && (
        <>
          <Alert kind="error">{t('clients.notFound')}</Alert>
          <TextLink to="/app/clients">{t('clients.backToList')}</TextLink>
        </>
      )}
      {!notFound && client.isPending && <p role="status">{t('app.loading')}</p>}
      {client.isError && (
        <>
          <Alert kind="error">{t(errorMessageKey(client.error))}</Alert>
          <TextLink to="/app/clients">{t('clients.backToList')}</TextLink>
        </>
      )}
      {client.isSuccess && client.data !== null && (
        <ClientForm
          defaultValues={{
            name: client.data.name,
            matricule_fiscal: client.data.matricule_fiscal ?? '',
            address: client.data.address ?? '',
            email: client.data.email ?? '',
            phone: client.data.phone ?? '',
          }}
          onSubmit={(values) => update.mutate(values)}
          pending={update.isPending}
          errorKey={update.isError ? errorMessageKey(update.error, UPDATE_ERRORS) : null}
          submitLabel={t('clients.update.submit')}
          pendingLabel={t('clients.update.submitting')}
        />
      )}
    </>
  )
}
