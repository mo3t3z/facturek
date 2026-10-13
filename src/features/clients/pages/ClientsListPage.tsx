import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Alert } from '../../../components/FormControls'
import { dangerButton, primaryButton, secondaryButton } from '../../../components/styles'
import { errorMessageKey } from '../../../lib/errors'
import { useOrganization } from '../../organizations/useOrganization'
import { type Client, clientsKey, deleteClient, listClients } from '../api'
import { filterClients } from '../search'

// Deleting a client can only hit a foreign key for one reason: a devis or a facture
// still points at it (documents_client_fk). So this screen can say exactly that.
const DELETE_ERRORS = { '23503': 'clients.errors.inUse' }

export function ClientsListPage() {
  const { t } = useTranslation()
  const organization = useOrganization()
  const queryClient = useQueryClient()
  const searchId = useId()
  const [search, setSearch] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  const clients = useQuery({
    queryKey: clientsKey(organization.id),
    // No silent retries: a failure is shown at once, with a retry button.
    retry: false,
    queryFn: () => listClients(organization.id),
  })

  const remove = useMutation({
    mutationFn: (client: Client) => deleteClient(organization.id, client.id),
    onSettled: async () => {
      setConfirming(null)
      await queryClient.invalidateQueries({ queryKey: clientsKey(organization.id) })
    },
  })

  const visible = clients.isSuccess ? filterClients(clients.data, search) : []

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{t('clients.title')}</h1>
        <Link to="/app/clients/new" className={primaryButton}>
          {t('clients.new')}
        </Link>
      </div>

      <div className="mb-4">
        <label htmlFor={searchId} className="mb-1 block text-sm font-medium text-slate-700">
          {t('clients.search')}
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-describedby={`${searchId}-hint`}
          autoComplete="off"
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <p id={`${searchId}-hint`} className="mt-1 text-sm text-slate-500">
          {t('clients.searchHint')}
        </p>
      </div>

      {remove.isError && <Alert kind="error">{t(errorMessageKey(remove.error, DELETE_ERRORS))}</Alert>}

      {clients.isPending && <p role="status">{t('app.loading')}</p>}

      {clients.isError && (
        <div>
          <Alert kind="error">
            {t('clients.loadError')} {t(errorMessageKey(clients.error))}
          </Alert>
          <button type="button" onClick={() => void clients.refetch()} className={primaryButton}>
            {t('home.retry')}
          </button>
        </div>
      )}

      {clients.isSuccess && (
        <>
          {/* Announced by screen readers each time the search changes the result. */}
          <p role="status" className="mb-3 text-sm text-slate-600">
            {clients.data.length === 0
              ? t('clients.empty')
              : visible.length === 0
                ? t('clients.noMatch')
                : t('clients.count', { count: visible.length })}
          </p>
          <ul className="space-y-3">
            {visible.map((client) => (
              <li key={client.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                {/* User-provided text, rendered as text only (never as HTML). */}
                <h2 className="break-words text-base font-semibold text-slate-900">{client.name}</h2>
                <div className="mt-1 space-y-0.5 break-words text-sm text-slate-600">
                  {client.matricule_fiscal && <p>{client.matricule_fiscal}</p>}
                  {client.address && <p>{client.address}</p>}
                  {client.email && <p>{client.email}</p>}
                  {client.phone && <p>{client.phone}</p>}
                </div>

                {confirming === client.id ? (
                  <div role="group" aria-label={t('clients.deleteNamed', { name: client.name })} className="mt-3">
                    <p className="mb-2 break-words text-sm font-medium text-slate-900">
                      {t('clients.deleteQuestion', { name: client.name })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(client)}
                        className={dangerButton}
                      >
                        {remove.isPending ? t('clients.deleting') : t('clients.deleteConfirm')}
                      </button>
                      <button
                        type="button"
                        // The keyboard lands on the safe choice.
                        autoFocus
                        disabled={remove.isPending}
                        onClick={() => setConfirming(null)}
                        className={secondaryButton}
                      >
                        {t('clients.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to={`/app/clients/${client.id}/edit`}
                      aria-label={t('clients.editNamed', { name: client.name })}
                      className={secondaryButton}
                    >
                      {t('clients.edit')}
                    </Link>
                    <button
                      type="button"
                      aria-label={t('clients.deleteNamed', { name: client.name })}
                      onClick={() => {
                        remove.reset()
                        setConfirming(client.id)
                      }}
                      className={secondaryButton}
                    >
                      {t('clients.delete')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
