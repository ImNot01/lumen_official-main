import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { useRealtime } from './RealtimeContext'
import type { ChatRow } from '../lib/chat'

type ListState = 'loading' | 'ready' | 'error'
type ChatListState = { rows: ChatRow[]; state: ListState; refresh: () => void; unreadTotal: number }

const Ctx = createContext<ChatListState | null>(null)

export function ChatListProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const rt = useRealtime()
  const [rows, setRows] = useState<ChatRow[]>([])
  const [state, setState] = useState<ListState>('loading')
  const hasData = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    if (!me) return
    const { data, error } = await supabase.rpc('get_chat_list')
    if (error) {
      if (!hasData.current) setState('error')
      return
    }
    hasData.current = true
    setRows(((data ?? []) as ChatRow[]).map((r) => ({ ...r, unread: Number(r.unread) })))
    setState('ready')
  }, [me])

  useEffect(() => {
    if (me) {
      setState('loading')
      hasData.current = false
      void load()
    } else {
      setRows([])
    }
  }, [me, load])

  useEffect(() => {
    if (!me) return
    const schedule = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void load(), 300)
    }
    const offMsg = rt.on('message', schedule)
    const offMember = rt.on('member', (p: any) => {
      if (p?.user_id === me) schedule()
    })
    const offResync = rt.on('resync', () => void load())
    return () => {
      offMsg()
      offMember()
      offResync()
      window.clearTimeout(timer.current)
    }
  }, [rt, me, load])

  const unreadTotal = useMemo(() => rows.reduce((sum, r) => sum + (r.muted ? 0 : r.unread), 0), [rows])
  const value = useMemo(() => ({ rows, state, refresh: () => void load(), unreadTotal }), [rows, state, load, unreadTotal])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useChatList(): ChatListState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChatList must be used inside ChatListProvider')
  return v
}
