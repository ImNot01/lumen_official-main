import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { mapAuthError } from '../lib/errors'
import { useAuth } from '../context/AuthContext'
import { Alert, AuthShell, Field, Spinner, Splash } from '../components/ui'

export default function ResetPassword() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <Splash />

  if (!session) {
    return (
      <AuthShell title="Link expired" subtitle="This reset link is invalid or has already been used.">
        <Link to="/forgot" className="btn-primary w-full">Request a new link</Link>
      </AuthShell>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) setError(mapAuthError(err.message))
      else navigate('/', { replace: true })
    } catch (ex) {
      setError(mapAuthError(ex instanceof Error ? ex.message : 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 8 characters.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="New password" id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm new password" id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />} Save password
        </button>
      </form>
    </AuthShell>
  )
}
