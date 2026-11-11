import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { mapAuthError } from '../lib/errors'
import { Alert, AuthShell, Field, Spinner } from '../components/ui'

export default function Forgot() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) return setError('Enter your email.')
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (err) setError(mapAuthError(err.message))
      else setSent(true)
    } catch (ex) {
      setError(mapAuthError(ex instanceof Error ? ex.message : 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={<Link to="/login" className="link">Back to sign in</Link>}
    >
      {sent ? (
        <Alert kind="success">If an account exists for that email, a reset link is on its way. Check your inbox.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Email" id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  )
}
