import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useAuth } from './context/AuthContext'
import { configured } from './lib/supabase'
import { AuthShell, Splash } from './components/ui'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Register from './pages/Register'
import Forgot from './pages/Forgot'
import ResetPassword from './pages/ResetPassword'
import People from './pages/People'
import ProfilePage from './pages/Profile'
import UserProfile from './pages/UserProfile'
import ChatLayout from './components/ChatLayout'
import Landing from './pages/Landing'

function Root() {
  const { session, loading } = useAuth()
  if (loading) return <Splash />
  return session ? <ChatLayout /> : <Landing />
}

function RequireAuth({ children }: { children: ReactElement }) {
  const { session, loading } = useAuth()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace />
  return <AppShell>{children}</AppShell>
}

function RequireChat({ children }: { children: ReactElement }) {
  const { session, loading } = useAuth()
  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace />
  return children
}

function PublicOnly({ children }: { children: ReactElement }) {
  const { session, loading } = useAuth()
  if (loading) return <Splash />
  if (session) return <Navigate to="/" replace />
  return children
}

export default function App() {
  if (!configured) {
    return (
      <AuthShell title="Almost there" subtitle="Lumen is not connected to its database yet.">
        <p className="text-[15px] leading-relaxed">
          Create a file named <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/10">.env</code> in the
          project folder with your <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong>, then
          stop and restart <code className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/10">npm run dev</code>.
        </p>
      </AuthShell>
    )
  }
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/forgot" element={<PublicOnly><Forgot /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Root />} />
      <Route path="/chat/:id" element={<RequireChat><ChatLayout /></RequireChat>} />
      <Route path="/people" element={<RequireAuth><People /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="/u/:username" element={<RequireAuth><UserProfile /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
