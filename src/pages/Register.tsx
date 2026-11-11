import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { USERNAME_RE, mapAuthError } from '../lib/errors'
import { Alert, AuthShell, Field, Spinner } from '../components/ui'

type UState = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid' | 'error'

export default function Register() {
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [uState, setUState] = useState<UState>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const u = username.trim().toLowerCase()
    if (!u) {
      setUState('idle')
      return
    }
    if (!USERNAME_RE.test(u)) {
      setUState('invalid')
      return
    }
    setUState('checking')
    let cancelled = false
    const t = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('is_username_available', { u })
      if (cancelled) return
      if (err) setUState('error')
      else setUState(data ? 'ok' : 'taken')
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [username])

  const hint = {
    idle: <span className="text-slate-500 dark:text-slate-400">3-24 characters: letters, numbers, dot, underscore.</span>,
    checking: <span className="text-slate-500 dark:text-slate-400">Checking availability...</span>,
    ok: <span className="text-emerald-600 dark:text-emerald-400">Username is available.</span>,
    taken: <span className="text-red-600 dark:text-red-400">That username is taken.</span>,
    invalid: <span className="text-red-600 dark:text-red-400">Use 3-24 lowercase letters, numbers, dots or underscores.</span>,
    error: <span className="text-amber-600 dark:text-amber-400">Could not check right now. You can still try to sign up.</span>,
  }[uState]

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const u = username.trim().toLowerCase()
    const dn = displayName.trim()
    if (!dn) return setError('Enter your name.')
    if (!USERNAME_RE.test(u)) return setError('Choose a valid username.')
    if (uState === 'taken') return setError('That username is taken. Pick another one.')
    if (!email.trim()) return setError('Enter your email.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setBusy(true)
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { username: u, display_name: dn }, emailRedirectTo: window.location.origin },
      })
      if (err) {
        setError(mapAuthError(err.message))
        return
      }
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setError('An account with this email already exists.')
        return
      }
      if (!data.session) {
        setNotice('Account created. Open the confirmation email we sent you, then sign in.')
      }
    } catch (ex) {
      setError(mapAuthError(ex instanceof Error ? ex.message : 'Something went wrong.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your messages stay between you and the people you talk to."
      footer={
        <>
          Already have an account? <Link to="/login" className="link">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <Field label="Name" id="display_name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} placeholder="Your name" />
        <Field
          label="Username"
          id="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          maxLength={24}
          placeholder="yourname"
          hint={hint}
        />
        <Field label="Email" id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Field label="Password" id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        <Field label="Confirm password" id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />} Create account
        </button>
      </form>
    </AuthShell>
  )
}
