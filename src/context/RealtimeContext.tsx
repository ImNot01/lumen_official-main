import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { fire } from '../lib/chat'

type Handler = (payload: any) => void
type Status = 'connecting' | 'connected' | 'reconnecting'

type RealtimeState = {
  status: Status
  online: Set<string>
  on: (event: string, handler: Handler) => () => void
  dispatch: (event: string, payload: unknown) => void
}

const Ctx = createContext<RealtimeState | null>(null)
const EVENTS = ['message', 'reaction', 'member']

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const handlers = useRef(new Map<string, Set<Handler>>())
  const deliveredCallSignals = useRef(new Set<string>())
  const [status, setStatus] = useState<Status>('connecting')
  const [online, setOnline] = useState<Set<string>>(new Set())

  const emit = useCallback((event: string, payload: unknown) => {
    handlers.current.get(event)?.forEach((h) => {
      try {
        h(payload)
      } catch (err) {
        console.error('Realtime handler error', err)
      }
    })
  }, [])

  const on = useCallback((event: string, handler: Handler) => {
    let set = handlers.current.get(event)
    if (!set) {
      set = new Set()
      handlers.current.set(event, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }, [])

  const receiveCallSignal = useCallback((signal: {
    id: string
    call_id: string
    conversation_id: string
    sender_id: string
    recipient_id: string
    type: string
    payload: Record<string, unknown>
  }) => {
    if (deliveredCallSignals.current.has(signal.id)) return
    if (deliveredCallSignals.current.size >= 512) deliveredCallSignals.current.clear()
    deliveredCallSignals.current.add(signal.id)
    emit('call', {
      ...signal.payload,
      type: signal.type,
      call_id: signal.call_id,
      conversation_id: signal.conversation_id,
      from: signal.sender_id,
      to: signal.recipient_id,
    })
    fire(supabase.from('call_signals').delete().eq('id', signal.id).eq('recipient_id', me))
  }, [emit, me])

  // live updates for everything that concerns this user
  useEffect(() => {
    if (!me) return
    let cancelled = false
    let everConnected = false
    let deliverTimer: number | undefined
    void supabase.realtime.setAuth()

    const ch = supabase.channel(`user:${me}`, { config: { private: true } })
    for (const ev of EVENTS) {
      ch.on('broadcast', { event: ev }, (msg) => {
        const payload = msg.payload as any
        if (ev === 'message' && payload?.record && payload.record.sender_id !== me) {
          window.clearTimeout(deliverTimer)
          deliverTimer = window.setTimeout(() => fire(supabase.rpc('mark_delivered')), 400)
        }
        emit(ev, payload)
      })
    }
    ch.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'call_signals',
      filter: `recipient_id=eq.${me}`,
    }, (change) => {
      receiveCallSignal(change.new as Parameters<typeof receiveCallSignal>[0])
    })
    ch.subscribe((s) => {
      if (cancelled) return
      const st = String(s)
      if (st === 'SUBSCRIBED') {
        setStatus('connected')
        if (everConnected) emit('resync', null)
        everConnected = true
        fire(supabase.rpc('mark_delivered'))
        void supabase.from('call_signals')
          .select('id, call_id, conversation_id, sender_id, recipient_id, type, payload')
          .eq('recipient_id', me)
          .gte('created_at', new Date(Date.now() - 60000).toISOString())
          .order('created_at', { ascending: true })
          .then(({ data, error }) => {
            if (error) {
              console.error('Could not restore pending call signals', error.message)
              return
            }
            for (const signal of data ?? []) {
              receiveCallSignal(signal as Parameters<typeof receiveCallSignal>[0])
            }
          })
      } else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        setStatus('reconnecting')
      }
    })

    return () => {
      cancelled = true
      window.clearTimeout(deliverTimer)
      void supabase.removeChannel(ch)
    }
  }, [me, emit, receiveCallSignal])

  // who is online right now (real connections only)
  useEffect(() => {
    if (!me) return
    const ch = supabase.channel('presence:online', { config: { private: true, presence: { key: me } } })
    ch.on('presence', { event: 'sync' }, () => {
      setOnline(new Set(Object.keys(ch.presenceState())))
    })
    ch.subscribe((s) => {
      if (String(s) === 'SUBSCRIBED') void ch.track({ at: Date.now() })
    })
    return () => {
      setOnline(new Set())
      void supabase.removeChannel(ch)
    }
  }, [me])

  // "last seen" heartbeat
  useEffect(() => {
    if (!me) return
    const beat = () => {
      fire(supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', me))
    }
    beat()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') beat()
    }, 60000)
    const onVis = () => {
      if (document.visibilityState === 'hidden') beat()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [me])

  // browser regained internet -> ask screens to refresh
  useEffect(() => {
    const onOnline = () => emit('resync', null)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [emit])

  const value = useMemo(() => ({ status, online, on, dispatch: emit }), [status, online, on, emit])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRealtime(): RealtimeState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRealtime must be used inside RealtimeProvider')
  return v
}
