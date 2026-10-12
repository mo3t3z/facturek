import { AuthApiError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RouteObject } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, fakeSession, renderRoutes } from '../../../test/helpers'

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { auth } }))

import { AuthConfirmPage } from './AuthConfirmPage'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { LoginPage } from './LoginPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { SignupPage } from './SignupPage'

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/auth/confirm', element: <AuthConfirmPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/app', element: <p>app home</p> },
]
const apiError = (code: string, status = 400) => new AuthApiError(`internal detail for ${code}`, status, code)
const networkError = () => Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })
const password = 'correct-horse-battery'
// No artificial delay between keystrokes: the forms are typed into many times.
const user = userEvent.setup({ delay: null })

beforeEach(() => {
  vi.clearAllMocks()
  auth.signOut.mockResolvedValue({ error: null })
})

describe('login', () => {
  async function failLoginWith(code: string) {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: apiError(code) })
    const view = renderRoutes(routes, '/login')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'amel@example.tn')
    await user.type(screen.getByLabelText('Mot de passe'), 'whatever-password')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    const text = (await screen.findByRole('alert')).textContent
    view.unmount()
    return text
  }

  it('shows the same message for a wrong password, an unknown address and an unconfirmed address', async () => {
    const wrongPassword = await failLoginWith('invalid_credentials')
    const unconfirmed = await failLoginWith('email_not_confirmed')
    const unknownUser = await failLoginWith('user_not_found')
    expect(wrongPassword).toMatch(/^Connexion impossible/)
    expect(unconfirmed).toBe(wrongPassword)
    expect(unknownUser).toBe(wrongPassword)
    expect(wrongPassword).not.toContain('internal detail')
  })

  it('validates in the browser first and ties each error to its field', async () => {
    renderRoutes(routes, '/login')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    const email = screen.getByLabelText('Adresse e-mail')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription('Ce champ est obligatoire.')
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('sends the credentials to supabase-js and stores nothing itself', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    renderRoutes(routes, '/login')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'amel@example.tn')
    await user.type(screen.getByLabelText('Mot de passe'), password)
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'amel@example.tn', password }),
    )
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })
})

describe('signup', () => {
  async function submitSignup() {
    await user.type(screen.getByLabelText('Nom complet'), 'Amel Ben Salah')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'amel@example.tn')
    await user.type(screen.getByLabelText('Mot de passe'), password)
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), password)
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }))
  }
  async function screenAfterSignup(result: object) {
    auth.signUp.mockResolvedValue(result)
    const view = renderRoutes(routes, '/signup')
    await submitSignup()
    const heading = await screen.findByRole('heading', { name: 'Vérifiez votre boîte mail' })
    const html = view.container.innerHTML
    expect(heading).toBeInTheDocument()
    view.unmount()
    return html
  }

  it('shows the identical "check your inbox" screen for a new and an already registered address', async () => {
    const fresh = await screenAfterSignup({ data: { user: { id: 'u1' }, session: null }, error: null })
    const obfuscated = await screenAfterSignup({ data: { user: { id: 'fake' }, session: null }, error: null })
    const existsError = await screenAfterSignup({ data: {}, error: apiError('user_already_exists', 422) })
    const emailExists = await screenAfterSignup({ data: {}, error: apiError('email_exists', 422) })
    expect(obfuscated).toBe(fresh)
    expect(existsError).toBe(fresh)
    expect(emailExists).toBe(fresh)
    const justEmailed = await screenAfterSignup({ data: {}, error: apiError('over_email_send_rate_limit', 429) })
    expect(justEmailed).toBe(fresh)
  })

  it('passes the name as metadata for the database trigger and asks for no redirect URL', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: null })
    renderRoutes(routes, '/signup')
    await submitSignup()
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledTimes(1))
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'amel@example.tn',
      password,
      options: { data: { full_name: 'Amel Ben Salah' } },
    })
  })

  it('reports a real problem (weak password) instead of the inbox screen', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: apiError('weak_password', 422) })
    renderRoutes(routes, '/signup')
    await submitSignup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce mot de passe est trop faible.')
    expect(screen.queryByRole('heading', { name: 'Vérifiez votre boîte mail' })).not.toBeInTheDocument()
  })

  it('refuses a 9 character password before calling the server', async () => {
    renderRoutes(routes, '/signup')
    await user.type(screen.getByLabelText('Nom complet'), 'Amel')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'amel@example.tn')
    await user.type(screen.getByLabelText('Mot de passe'), '123456789')
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), '123456789')
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }))
    expect(await screen.findByText('Le mot de passe doit contenir au moins 10 caractères.')).toBeInTheDocument()
    expect(auth.signUp).not.toHaveBeenCalled()
  })
})

describe('forgot password', () => {
  async function screenAfterRequest(result: object) {
    auth.resetPasswordForEmail.mockResolvedValue(result)
    const view = renderRoutes(routes, '/forgot-password')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'amel@example.tn')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    await screen.findByRole('heading', { name: 'Vérifiez votre boîte mail' })
    const html = view.container.innerHTML
    view.unmount()
    return html
  }

  it('shows the identical confirmation whatever the server answered', async () => {
    const sent = await screenAfterRequest({ data: {}, error: null })
    const rateLimited = await screenAfterRequest({ data: null, error: apiError('over_email_send_rate_limit', 429) })
    const unknown = await screenAfterRequest({ data: null, error: apiError('user_not_found', 404) })
    const serverError = await screenAfterRequest({ data: null, error: apiError('unexpected_failure', 500) })
    expect(rateLimited).toBe(sent)
    expect(unknown).toBe(sent)
    expect(serverError).toBe(sent)
    expect(sent).toContain('Si un compte existe pour cette adresse')
  })

  it('only reports that the server could not be reached', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: networkError() })
    renderRoutes(routes, '/forgot-password')
    await user.type(screen.getByLabelText('Adresse e-mail'), 'amel@example.tn')
    await user.click(screen.getByRole('button', { name: 'Envoyer le lien' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connexion au serveur impossible.')
    expect(screen.queryByRole('heading', { name: 'Vérifiez votre boîte mail' })).not.toBeInTheDocument()
  })
})

describe('/auth/confirm', () => {
  it('does NOT spend the token when the page is merely opened', () => {
    renderRoutes(routes, '/auth/confirm?token_hash=abc123&type=email')
    expect(screen.getByRole('button', { name: 'Confirmer mon adresse' })).toBeInTheDocument()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it('verifies the token once when the button is pressed, then goes to /app', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    const { router } = renderRoutes(routes, '/auth/confirm?token_hash=abc123&type=email')
    await user.click(screen.getByRole('button', { name: 'Confirmer mon adresse' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1)
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'email' })
  })

  it('starts a recovery and goes to /reset-password for a recovery link', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    const state = authState()
    const { router } = renderRoutes(routes, '/auth/confirm?token_hash=abc123&type=recovery', state)
    await user.click(screen.getByRole('button', { name: 'Continuer' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/reset-password'))
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' })
    expect(state.beginRecovery).toHaveBeenCalledTimes(1)
  })

  it('ignores a ?next= in the link: the destination is fixed', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    const { router } = renderRoutes(routes, '/auth/confirm?token_hash=abc123&type=email&next=//evil.com&redirect_to=https://evil.com')
    await user.click(screen.getByRole('button', { name: 'Confirmer mon adresse' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
  })

  it('shows a French message for an expired or already used link', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: apiError('otp_expired', 403) })
    renderRoutes(routes, '/auth/confirm?token_hash=abc123&type=email')
    await user.click(screen.getByRole('button', { name: 'Confirmer mon adresse' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce lien a expiré ou a déjà été utilisé.')
  })

  it.each([
    '/auth/confirm',
    '/auth/confirm?token_hash=abc123',
    '/auth/confirm?type=email',
    '/auth/confirm?token_hash=abc123&type=invite',
    '/auth/confirm?token_hash=abc123&type=magiclink',
    '/auth/confirm?token_hash=&type=email',
  ])('rejects the malformed link %s without calling the server', (url) => {
    renderRoutes(routes, url)
    expect(screen.getByRole('alert')).toHaveTextContent('Ce lien est incomplet ou invalide.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
})

describe('/reset-password', () => {
  it.each([
    ['no session at all', authState()],
    ['an ordinary session without a recovery in progress', authState({ session: fakeSession() })],
    ['a recovery flag without a session', authState({ isRecovering: true })],
  ])('shows no form with %s', (_label, state) => {
    renderRoutes(routes, '/reset-password', state)
    expect(screen.getByRole('alert')).toHaveTextContent("n'est accessible que depuis le lien reçu par e-mail")
    expect(screen.queryByLabelText('Nouveau mot de passe')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/forgot-password')
  })

  it('changes the password, signs out the other sessions and ends the recovery', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    const state = authState({ session: fakeSession(), isRecovering: true })
    const { router } = renderRoutes(routes, '/reset-password', state)
    await user.type(screen.getByLabelText('Nouveau mot de passe'), password)
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), password)
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
    expect(auth.updateUser).toHaveBeenCalledWith({ password })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' })
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0] ?? 0)
    expect(state.endRecovery).toHaveBeenCalledTimes(1)
  })

  it('does not sign anyone out when the password change is refused', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: apiError('same_password', 422) })
    const state = authState({ session: fakeSession(), isRecovering: true })
    renderRoutes(routes, '/reset-password', state)
    await user.type(screen.getByLabelText('Nouveau mot de passe'), password)
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), password)
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doit être différent de l'ancien")
    expect(auth.signOut).not.toHaveBeenCalled()
    expect(state.endRecovery).not.toHaveBeenCalled()
  })

  it('still succeeds if signing out the other sessions fails', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    auth.signOut.mockRejectedValue(new Error('network'))
    const state = authState({ session: fakeSession(), isRecovering: true })
    const { router } = renderRoutes(routes, '/reset-password', state)
    await user.type(screen.getByLabelText('Nouveau mot de passe'), password)
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), password)
    await user.click(screen.getByRole('button', { name: 'Enregistrer le mot de passe' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'))
  })
})
