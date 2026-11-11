import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getPermission, registerPushSubscription, requestPermission } from '../lib/notify'

const KEY = 'lumen:notif-banner-dismissed'

export default function NotifyBanner() {
  const { session } = useAuth()
  const me = session?.user.id
  const [perm, setPerm] = useState(getPermission())
  const [error, setError] = useState<string | null>(() =>
    getPermission() === 'denied'
      ? 'Notifications are blocked for this site. Allow them in Chrome site settings, then reload Lumen.'
      : null,
  )
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = window.setInterval(() => setPerm(getPermission()), 2000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!me || perm !== 'granted') return
    let active = true
    void registerPushSubscription(me).then(() => {
      if (active) setError(null)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not set up push notifications.')
    })
    return () => {
      active = false
    }
  }, [me, perm])

  if ((perm !== 'default' && !error) || (dismissed && !error)) return null

  async function enable() {
    setBusy(true)
    setError(null)
    try {
      const permission = await requestPermission()
      setPerm(permission)
      if (permission === 'granted') {
        if (!me) throw new Error('Sign in before enabling message notifications.')
        await registerPushSubscription(me)
      } else if (permission === 'denied') {
        throw new Error('Notifications are blocked for this site. Allow them in Chrome site settings, then try again.')
      } else if (permission === 'unsupported') {
        throw new Error('This browser does not support web push notifications.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not enable push notifications.')
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* storage unavailable */
    }
    setDismissed(true)
  }

  return (
    <div className="animate-slide-up flex items-center justify-between gap-3 border-b border-slate-200/80 bg-brand-50 px-4 py-2.5 text-sm dark:border-white/10 dark:bg-brand-500/10">
      <span role={error ? 'alert' : undefined}>{error ?? 'Enable push notifications to receive new messages when Lumen is closed.'}</span>
      <div className="flex shrink-0 gap-3">
        {perm !== 'denied' && <button type="button" onClick={() => void enable()} disabled={busy} className="font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">
          {busy ? 'Enabling...' : error || perm === 'granted' ? 'Retry' : 'Enable'}
        </button>}
        {!error && <button type="button" onClick={dismiss} className="text-slate-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400">Not now</button>}
      </div>
    </div>
  )
}
