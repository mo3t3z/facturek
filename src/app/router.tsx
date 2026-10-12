import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { RedirectIfAuthed, RequireAuth } from '../features/auth/guards'
import { AuthConfirmPage } from '../features/auth/pages/AuthConfirmPage'
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
import { AppHomePage } from './AppHomePage'

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
    children: [{ path: '/app', element: <AppHomePage /> }],
  },
  { path: '*', element: <Navigate to="/app" replace /> },
]

export const router = createBrowserRouter(routes)
