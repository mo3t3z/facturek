import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RedirectIfAuthed, RequireAuth } from '../features/auth/guards'
import { AuthConfirmPage } from '../features/auth/pages/AuthConfirmPage'
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
import { ClientCreatePage } from '../features/clients/pages/ClientCreatePage'
import { ClientEditPage } from '../features/clients/pages/ClientEditPage'
import { ClientsListPage } from '../features/clients/pages/ClientsListPage'
import { RequireOrganization } from '../features/organizations/RequireOrganization'
import { AppHomePage } from './AppHomePage'
import { AppLayout } from './AppLayout'

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/app" replace /> },
  // Email links land here whether or not a session already exists.
  { path: '/auth/confirm', element: <AuthConfirmPage /> },
  // Decides by itself what to show (it needs a recovery in progress, not just a session).
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          // The dashboard handles a missing organization itself (it offers the retry).
          { path: '/app', element: <AppHomePage /> },
          {
            element: <RequireOrganization />,
            children: [
              { path: '/app/clients', element: <ClientsListPage /> },
              { path: '/app/clients/new', element: <ClientCreatePage /> },
              { path: '/app/clients/:clientId/edit', element: <ClientEditPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/app" replace /> },
]

export const router = createBrowserRouter(routes)
