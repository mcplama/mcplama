/* Copyright (c) 2026 MCPlama <dev@mcplama.com> */
/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import { SetupProvider, useSetup } from './hooks/useSetup'

import Shell from './components/layout/Shell'
import { Spinner } from './components/ui'

// Pages
import Login          from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword  from './pages/ResetPassword'
import Setup          from './pages/Setup'
import Dashboard      from './pages/Dashboard'
import Catalog        from './pages/Catalog'
import Servers        from './pages/Servers'
import ServerDetail   from './pages/ServerDetail'
import ServerEdit     from './pages/ServerEdit'
import Tools          from './pages/Tools'
import Users          from './pages/Users'
import Audit          from './pages/Audit'
import SettingsPage   from './pages/SettingsPage'
import Portal         from './pages/Portal'
import AcceptInvite   from './pages/AcceptInvite'
import OAuthCallback  from './pages/OAuthCallback'
import McpAuthorize   from './pages/McpAuthorize'
import { Connections } from './pages/Connections'
import { Policies }       from './pages/PoliciesPage'
import ActivityPage from './pages/ActivityPage'
import AlertsPage  from './pages/AlertsPage'
import ReportsPage from './pages/ReportsPage'

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <Spinner size={24} />
    </div>
  )
}

function Protected({ children, noShell = false }) {
  const { user, loading } = useAuth()
  const { setupDone, loading: setupLoading } = useSetup()

  if (loading || setupLoading || setupDone === null) return <Splash />
  if (!setupDone) return <Navigate to="/setup" replace />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'member') return <Navigate to="/portal" replace />
  if (noShell) return children
  return <Shell>{children}</Shell>
}

function MemberOnly({ children }) {
  const { user, loading } = useAuth()
  const { setupDone, loading: setupLoading } = useSetup()

  if (loading || setupLoading) return <Splash />
  if (!setupDone) return <Navigate to="/setup" replace />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'admin') return <Navigate to="/" replace />
  return children
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth()
  const { setupDone, loading: setupLoading } = useSetup()

  if (loading || setupLoading) return <Splash />
  if (!setupDone) return <Navigate to="/setup" replace />
  if (user?.role === 'admin') return <Navigate to="/" replace />
  if (user?.role === 'member') return <Navigate to="/portal" replace />
  return children
}

function SetupGuard({ children }) {
  const { setupDone, loading } = useSetup()

  if (loading) return <Splash />
  if (setupDone === true) return <Navigate to="/login" replace />
  if (setupDone === false) return children
  return <Splash />
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <SetupProvider>
          <AuthProvider>
            <Routes>
              {/* Public */}
              <Route path="/setup"          element={<SetupGuard><Setup /></SetupGuard>} />
              <Route path="/login"          element={<PublicOnly><Login /></PublicOnly>} />
              <Route path="/forgot-password"      element={<PublicOnly><ForgotPassword /></PublicOnly>} />
              <Route path="/reset-password/:token" element={<PublicOnly><ResetPassword /></PublicOnly>} />
              <Route path="/invite/:token"  element={<AcceptInvite />} />
              <Route path="/oauth/callback" element={<OAuthCallback />} />
              <Route path="/mcp-authorize"  element={<McpAuthorize />} />

              {/* Member */}
              <Route path="/portal" element={<MemberOnly><Portal /></MemberOnly>} />

              {/* Admin */}
              <Route path="/"              element={<Protected><Dashboard /></Protected>} />
              <Route path="/catalog"       element={<Protected><Catalog /></Protected>} />
              <Route path="/servers"       element={<Protected><Servers /></Protected>} />
              <Route path="/servers/:id"   element={<Protected><ServerDetail /></Protected>} />
              <Route path="/servers/:id/edit" element={<Protected><ServerEdit /></Protected>} />
              <Route path="/connections"   element={<Protected><Connections /></Protected>} />
              <Route path="/tools"         element={<Protected><Tools /></Protected>} />
              <Route path="/policies"      element={<Protected><Policies /></Protected>} />
              <Route path="/users"         element={<Protected><Users /></Protected>} />
              <Route path="/audit"         element={<Protected><Audit /></Protected>} />
              <Route path="/activity"      element={<Protected><ActivityPage /></Protected>} />
              <Route path="/alerts"        element={<Protected><AlertsPage /></Protected>} />
              <Route path="/reports"       element={<Protected><ReportsPage /></Protected>} />
              <Route path="/settings"      element={<Protected><SettingsPage /></Protected>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </SetupProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
