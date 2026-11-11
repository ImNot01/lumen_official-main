import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { Profile } from '../context/AuthContext'
import { Avatar } from '../components/Avatar'
import { Alert, Spinner, Splash } from '../components/ui'

type Load = 'loading' | 'ready' | 'missing' | 'error'
type Msg = { kind: 'error' | 'success'; text: string } | null

export default function UserProfile() {
  const { username = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)

  const [load, setLoad] = useState<Load>('loading')
  const [target, setTarget] = useState<Profile | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [reportBusy, setReportBusy] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoad('loading')
    setMsg(null)
    setReporting(false)
    const { data, error } = await supabase.from('profiles').select('*').eq('username', username.toLowerCase()).maybeSingle()
    if (error) {
      setLoad('error')
      return
    }
    if (!data) {
      setTarget(null)
      setLoad('missing')
      return
    }
    const p = data as Profile
    const { data: b, error: bErr } = await supabase
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', me)
      .eq('blocked_id', p.id)
      .maybeSingle()
    if (bErr) {
      setLoad('error')
      return
    }
    setTarget(p)
    setBlocked(Boolean(b))
    setLoad('ready')
  }, [username, me])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  async function startChat() {
    if (!target) return
    setMsg(null)
    setStarting(true)
    try {
      const { data, error } = await supabase.rpc('get_or_create_direct', { other_user: target.id })
      if (error || !data) {
        setMsg({ kind: 'error', text: error?.message ?? 'Could not open the chat. Try again.' })
        return
      }
      navigate(`/chat/${data as string}`)
    } catch (ex) {
      setMsg({ kind: 'error', text: ex instanceof Error ? ex.message : 'Could not open the chat.' })
    } finally {
      setStarting(false)
    }
  }

  async function toggleBlock() {
    if (!target) return
    setMsg(null)
    setBusy(true)
    try {
      const res = blocked
        ? await supabase.from('blocked_users').delete().eq('blocker_id', me).eq('blocked_id', target.id)
        : await supabase.from('blocked_users').insert({ blocker_id: me, blocked_id: target.id })
      if (res.error) {
        setMsg({ kind: 'error', text: res.error.message })
        return
      }
      setBlocked(!blocked)
      setMsg({ kind: 'success', text: blocked ? `${target.display_name} is unblocked.` : `${target.display_name} is blocked. They can no longer message you.` })
    } catch (ex) {
      setMsg({ kind: 'error', text: ex instanceof Error ? ex.message : 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  async function submitReport(e: FormEvent) {
    e.preventDefault()
    if (!target) return
    const r = reason.trim()
    if (!r) return setMsg({ kind: 'error', text: 'Tell us what happened.' })
    setMsg(null)
    setReportBusy(true)
    try {
      const { error } = await supabase.from('reports').insert({ reporter_id: me, reported_user_id: target.id, reason: r })
      if (error) {
        setMsg({ kind: 'error', text: error.message })
        return
      }
      setReporting(false)
      setReason('')
      setMsg({ kind: 'success', text: 'Report sent. Thank you.' })
    } catch (ex) {
      setMsg({ kind: 'error', text: ex instanceof Error ? ex.message : 'Could not send the report.' })
    } finally {
      setReportBusy(false)
    }
  }

  if (load === 'loading') return <Splash />

  if (load === 'error') {
    return (
      <div className="space-y-3">
        <Alert kind="error">Could not load this profile. Check your connection and try again.</Alert>
        <button type="button" className="btn-ghost" onClick={() => void fetchAll()}>Retry</button>
      </div>
    )
  }

  if (load === 'missing' || !target) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">User not found</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">No one has the username @{username}.</p>
        <Link to="/people" className="btn-primary mt-6">Back to search</Link>
      </div>
    )
  }

  const isMe = target.id === me
  const since = new Date(target.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })

  return (
    <div className="space-y-5">
      <Link to="/people" className="link text-sm">Back to search</Link>

      <section className="glass p-6 text-center">
        <div className="flex justify-center">
          <Avatar path={target.avatar_path} name={target.display_name} size={112} />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{target.display_name}</h1>
        <p className="text-slate-500 dark:text-slate-400">@{target.username}</p>
        {target.bio && <p className="mx-auto mt-4 max-w-md whitespace-pre-wrap break-words text-[15px] leading-relaxed">{target.bio}</p>}
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Joined {since}</p>
      </section>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {isMe ? (
        <Link to="/profile" className="btn-primary w-full">Edit your profile</Link>
      ) : (
        <section className="glass space-y-3 p-6">
          {blocked ? (
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">Unblock this user to send messages.</p>
          ) : (
            <button type="button" className="btn-primary w-full" disabled={starting} onClick={() => void startChat()}>
              {starting && <Spinner className="h-4 w-4" />} Message
            </button>
          )}
          <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void toggleBlock()}>
            {busy && <Spinner className="h-4 w-4" />} {blocked ? 'Unblock user' : 'Block user'}
          </button>
          {!reporting ? (
            <button
              type="button"
              className="w-full py-2 text-sm font-medium text-red-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400"
              onClick={() => { setReporting(true); setMsg(null) }}
            >
              Report user
            </button>
          ) : (
            <form onSubmit={submitReport} className="space-y-3" noValidate>
              <label htmlFor="reason" className="block text-sm font-medium">What is the problem?</label>
              <textarea id="reason" className="input min-h-[96px] resize-y" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Describe what happened" />
              <div className="flex gap-2">
                <button type="button" className="btn-ghost flex-1" onClick={() => { setReporting(false); setReason('') }}>Cancel</button>
                <button type="submit" className="btn-danger flex-1" disabled={reportBusy}>
                  {reportBusy && <Spinner className="h-4 w-4" />} Send report
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  )
}
