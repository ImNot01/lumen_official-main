import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../context/RealtimeContext'
import { useCalls } from '../context/CallContext'
import { PAGE, cmpMsg, copyText, dayLabel, fire, isUuid, lastSeenText, previewOf, ts, uuid } from '../lib/chat'
import type { LocalMsg, Msg, ProfileLite, Reaction } from '../lib/chat'
import { addOutbox, getOutbox, removeOutbox } from '../lib/outbox'
import { useActiveChat } from '../context/ActiveChatContext'
import type { OutboxItem } from '../lib/outbox'
import { Avatar } from './Avatar'
import { Spinner } from './ui'
import MessageBubble from './MessageBubble'
import Composer from './Composer'

type Load = 'loading' | 'ready' | 'missing' | 'error'
type ReplySrc = { id: string; sender_id: string | null; kind: string; body: string | null; deleted_at: string | null }
const EMPTY: Reaction[] = []

function upsertMsg(list: LocalMsg[], m: Msg, onlyIfExists = false): LocalMsg[] {
  const cid = m.client_id
  const next = cid ? list.filter((x) => !(x.status !== 'sent' && x.client_id === cid)) : list.slice()
  const i = next.findIndex((x) => x.id === m.id)
  if (i < 0 && onlyIfExists) return list
  const sm: LocalMsg = { ...m, status: 'sent' }
  if (i >= 0) next[i] = sm
  else next.push(sm)
  return next.sort(cmpMsg)
}

function addReaction(map: Record<string, Reaction[]>, r: Reaction) {
  const cur = map[r.message_id] ?? []
  if (cur.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)) return map
  return { ...map, [r.message_id]: [...cur, r] }
}

function removeReaction(map: Record<string, Reaction[]>, r: Reaction) {
  const cur = map[r.message_id]
  if (!cur) return map
  const next = cur.filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji))
  if (next.length === cur.length) return map
  return { ...map, [r.message_id]: next }
}

export default function Conversation({ id }: { id: string }) {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const rt = useRealtime()
  const calls = useCalls()
  const { setActiveId } = useActiveChat()

  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>('loading')
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({})
  const [otherId, setOtherId] = useState<string | null>(null)
  const [conv, setConv] = useState<{ type: 'direct' | 'group'; name: string | null; avatar_path: string | null } | null>(null)
  const [memberCount, setMemberCount] = useState(0)
  const [muted, setMuted] = useState(false)
  const [receipts, setReceipts] = useState({ read: 0, delivered: 0 })
  const [msgs, setMsgs] = useState<LocalMsg[]>([])
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({})
  const [replyCache, setReplyCache] = useState<Record<string, ReplySrc>>({})
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<LocalMsg | null>(null)
  const [editing, setEditing] = useState<LocalMsg | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [typingIds, setTypingIds] = useState<string[]>([])
  const [newBelow, setNewBelow] = useState(false)

  const msgsRef = useRef<LocalMsg[]>([])
  msgsRef.current = msgs
  const reactionsRef = useRef<Record<string, Reaction[]>>({})
  reactionsRef.current = reactions
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const channelReady = useRef(false)
  const lastTyping = useRef(0)
  const typingTimers = useRef(new Map<string, number>())
  const readTimer = useRef<number | undefined>(undefined)
  const noticeTimer = useRef<number | undefined>(undefined)
  const outboxDone = useRef(false)
  const prevLastId = useRef('')

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000)
  }, [])

  // ---------- read state ----------
  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    window.clearTimeout(readTimer.current)
    readTimer.current = window.setTimeout(() => fire(supabase.rpc('mark_read', { cid: id })), 250)
  }, [id])

  // ---------- loading ----------
  const hydrate = useCallback(async (rows: Msg[]) => {
    if (rows.length === 0) return
    const ids = rows.map((r) => r.id)
    const { data: rx } = await supabase.from('message_reactions').select('message_id,user_id,emoji').in('message_id', ids)
    if (rx) {
      const grouped: Record<string, Reaction[]> = {}
      for (const mid of ids) grouped[mid] = []
      for (const r of rx as Reaction[]) grouped[r.message_id]?.push(r)
      setReactions((prev) => ({ ...prev, ...grouped }))
    }
    const known = new Set<string>([...msgsRef.current.map((m) => m.id), ...ids])
    const need = Array.from(new Set(rows.map((r) => r.reply_to_id).filter((x): x is string => !!x && !known.has(x))))
    if (need.length > 0) {
      const { data: rp } = await supabase.from('messages').select('id,sender_id,kind,body,deleted_at').in('id', need)
      if (rp) {
        setReplyCache((prev) => {
          const next = { ...prev }
          for (const r of rp as ReplySrc[]) next[r.id] = r
          return next
        })
      }
    }
  }, [])

  const loadAll = useCallback(async () => {
    if (!me) return
    if (!isUuid(id)) {
      setLoad('missing')
      return
    }
    try {
      const [convRes, memRes] = await Promise.all([
        supabase.from('conversations').select('id,type,name,avatar_path').eq('id', id).maybeSingle(),
        supabase.from('conversation_members').select('user_id,last_read_at,last_delivered_at').eq('conversation_id', id),
      ])
      if (convRes.error || memRes.error) {
        setLoad((l) => (l === 'ready' ? l : 'error'))
        return
      }
      const members = (memRes.data ?? []) as { user_id: string; last_read_at: string; last_delivered_at: string; muted: boolean }[]
      if (!convRes.data || !members.some((m) => m.user_id === me)) {
        setLoad('missing')
        return
      }
      const conversation = convRes.data as { id: string; type: 'direct' | 'group'; name: string | null; avatar_path: string | null }
      setConv(conversation)
      setMemberCount(members.length)
      const other = conversation.type === 'direct' ? members.find((m) => m.user_id !== me) : undefined
      setOtherId(other?.user_id ?? null)
      if (other) setReceipts({ read: ts(other.last_read_at), delivered: ts(other.last_delivered_at) })
      const mine = members.find((m) => m.user_id === me)
      setMuted(mine?.muted ?? false)

      const { data: profs, error: pErr } = await supabase
        .from('profiles')
        .select('id,username,display_name,avatar_path,last_seen')
        .in('id', members.map((m) => m.user_id))
      const { data: page, error: mErr } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(PAGE)
      if (pErr || mErr) {
        setLoad((l) => (l === 'ready' ? l : 'error'))
        return
      }
      setProfiles(Object.fromEntries((profs as ProfileLite[]).map((p) => [p.id, p])))
      const rows = (page as Msg[]).slice().reverse()
      setHasMore(rows.length === PAGE)
      setMsgs((prev) => rows.reduce((acc, m) => upsertMsg(acc, m), prev))
      await hydrate(rows)
      setLoad('ready')
      markRead()
    } catch {
      setLoad((l) => (l === 'ready' ? l : 'error'))
    }
  }, [id, me, hydrate, markRead])

  useEffect(() => {
    setLoad('loading')
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me])

  useEffect(() => {
    setActiveId(id)
    return () => setActiveId(null)
  }, [id, setActiveId])

  const loadOlder = useCallback(async () => {
    const oldest = msgsRef.current.find((m) => m.status === 'sent')
    if (!oldest || loadingMore) return
    setLoadingMore(true)
    const el = scrollRef.current
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', id)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE)
      if (error) {
        showNotice('Could not load older messages.')
        return
      }
      const rows = (data as Msg[]).slice().reverse()
      setHasMore(rows.length === PAGE)
      if (el) restore.current = { height: el.scrollHeight, top: el.scrollTop }
      setMsgs((prev) => rows.reduce((acc, m) => upsertMsg(acc, m), prev))
      await hydrate(rows)
    } finally {
      setLoadingMore(false)
    }
  }, [id, loadingMore, hydrate, showNotice])

  // ---------- sending ----------
  const fail = useCallback((clientId: string, text?: string) => {
    setMsgs((prev) => prev.map((m) => (m.client_id === clientId && m.status !== 'sent' ? { ...m, status: 'failed', error: text } : m)))
  }, [])

  const deliver = useCallback(
    async (item: OutboxItem) => {
      setMsgs((prev) =>
        prev.map((m) => (m.client_id === item.client_id && m.status !== 'sent' ? { ...m, status: 'sending', error: undefined } : m)),
      )
      try {
        const { data, error } = await supabase
          .from('messages')
          .insert({
            conversation_id: item.conversation_id,
            sender_id: me,
            kind: 'text',
            body: item.body,
            reply_to_id: item.reply_to_id,
            client_id: item.client_id,
          })
          .select()
          .single()
        if (!error && data) {
          removeOutbox(me, item.client_id)
          setMsgs((prev) => upsertMsg(prev, data as Msg))
          return
        }
        if (error?.code === '23505') {
          const { data: existing } = await supabase.from('messages').select('*').eq('client_id', item.client_id).eq('sender_id', me).maybeSingle()
          if (existing) {
            removeOutbox(me, item.client_id)
            setMsgs((prev) => upsertMsg(prev, existing as Msg))
            return
          }
        }
        if (error?.code === '42501') {
          removeOutbox(me, item.client_id)
          fail(item.client_id, 'You can no longer message this person.')
          return
        }
        fail(item.client_id)
      } catch {
        fail(item.client_id)
      }
    },
    [me, fail],
  )

  const send = useCallback(
    (text: string) => {
      const body = text.trim()
      if (!body) return
      if (body.length > 4000) {
        showNotice('That message is too long (4000 characters max).')
        return
      }
      const reply = replyTo && replyTo.status === 'sent' ? replyTo.id : null
      const clientId = uuid()
      const now = new Date().toISOString()
      const item: OutboxItem = { client_id: clientId, conversation_id: id, body, reply_to_id: reply, queued_at: now }
      addOutbox(me, item)
      setMsgs((prev) =>
        [...prev, { id: clientId, conversation_id: id, sender_id: me, kind: 'text', body, reply_to_id: reply, client_id: clientId, edited_at: null, deleted_at: null, created_at: now, status: 'sending' as const }].sort(cmpMsg),
      )
      setReplyTo(null)
      void deliver(item)
    },
    [id, me, replyTo, deliver, showNotice],
  )

  const retryAll = useCallback(() => {
    for (const item of getOutbox(me, id)) {
      const m = msgsRef.current.find((x) => x.client_id === item.client_id)
      if (m && m.status === 'failed') void deliver(item)
    }
  }, [me, id, deliver])

  // restore unsent messages from a previous session
  useEffect(() => {
    if (load !== 'ready' || outboxDone.current) return
    outboxDone.current = true
    const items = getOutbox(me, id)
    const fresh: OutboxItem[] = []
    for (const item of items) {
      if (msgsRef.current.some((m) => m.client_id === item.client_id && m.status === 'sent')) removeOutbox(me, item.client_id)
      else if (!msgsRef.current.some((m) => m.client_id === item.client_id)) fresh.push(item)
    }
    if (fresh.length === 0) return
    setMsgs((prev) =>
      [
        ...prev,
        ...fresh.map((i) => ({ id: i.client_id, conversation_id: id, sender_id: me, kind: 'text', body: i.body, reply_to_id: i.reply_to_id, client_id: i.client_id, edited_at: null, deleted_at: null, created_at: i.queued_at, status: 'failed' as const })),
      ].sort(cmpMsg),
    )
    if (navigator.onLine) for (const i of fresh) void deliver(i)
  }, [load, me, id, deliver])

  useEffect(() => {
    const onOnline = () => retryAll()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [retryAll])

  // ---------- realtime ----------
  useEffect(() => {
    const offMsg = rt.on('message', (p: any) => {
      const rec = p?.record as Msg | undefined
      if (!rec || rec.conversation_id !== id) return
      setMsgs((prev) => upsertMsg(prev, rec, p.op === 'UPDATE'))
      if (rec.sender_id && rec.sender_id !== me && p.op === 'INSERT') {
        markRead()
        void hydrate([rec])
        setTypingIds((prev) => prev.filter((x) => x !== rec.sender_id))
      }
      if (rec.sender_id === me) removeOutbox(me, rec.client_id)
    })
    const offReact = rt.on('reaction', (p: any) => {
      if (!p || p.conversation_id !== id) return
      const r: Reaction = { message_id: p.message_id, user_id: p.user_id, emoji: p.emoji }
      setReactions((prev) => (p.op === 'DELETE' ? removeReaction(prev, r) : addReaction(prev, r)))
    })
    const offMember = rt.on('member', (p: any) => {
      if (!p || p.conversation_id !== id) return
      if (typeof p.last_read_at === 'string' && p.user_id && p.user_id !== me) {
        setReceipts({ read: ts(p.last_read_at), delivered: ts(p.last_delivered_at) })
        return
      }
      if (p.joined_user_id || p.left_user_id) void loadAll()
    })
    const offRemoved = rt.on('removed', (p: any) => {
      if (p?.conversation_id !== id) return
      showNotice('You were removed from this group.')
      navigate('/', { replace: true })
    })
    const offResync = rt.on('resync', () => {
      void loadAll()
      retryAll()
    })
    return () => {
      offMsg()
      offReact()
      offMember()
      offRemoved()
      offResync()
    }
  }, [rt, id, me, markRead, hydrate, loadAll, retryAll, navigate, showNotice])

  // typing channel (private: only members can join)
  useEffect(() => {
    if (!me) return
    void supabase.realtime.setAuth()
    const ch = supabase.channel(`conv:${id}`, { config: { private: true, broadcast: { self: false } } })
    ch.on('broadcast', { event: 'typing' }, (msg) => {
      const p = msg.payload as { user_id?: string; typing?: boolean } | undefined
      if (!p || !p.user_id || p.user_id === me) return
      const uid = p.user_id
      const old = typingTimers.current.get(uid)
      if (old) window.clearTimeout(old)
      if (p.typing) {
        const t = window.setTimeout(() => {
          typingTimers.current.delete(uid)
          setTypingIds((prev) => prev.filter((x) => x !== uid))
        }, 4000)
        typingTimers.current.set(uid, t)
        setTypingIds((prev) => (prev.includes(uid) ? prev : [...prev, uid]))
      } else {
        typingTimers.current.delete(uid)
        setTypingIds((prev) => prev.filter((x) => x !== uid))
      }
    })
    ch.subscribe((s) => {
      channelReady.current = String(s) === 'SUBSCRIBED'
    })
    channelRef.current = ch
    const timers = typingTimers.current
    return () => {
      channelReady.current = false
      channelRef.current = null
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
      void supabase.removeChannel(ch)
    }
  }, [id, me, rt.dispatch])

  const sendTyping = useCallback(
    (typing: boolean) => {
      const ch = channelRef.current
      if (!ch || !channelReady.current) return
      const now = Date.now()
      if (typing) {
        if (now - lastTyping.current < 2500) return
        lastTyping.current = now
      } else {
        if (lastTyping.current === 0) return
        lastTyping.current = 0
      }
      void ch.send({ type: 'broadcast', event: 'typing', payload: { user_id: me, typing } })
    },
    [me],
  )

  // mark read when the tab becomes visible again
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') markRead()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
      window.clearTimeout(readTimer.current)
      window.clearTimeout(noticeTimer.current)
    }
  }, [markRead])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleMute = useCallback(async () => {
    const next = !muted
    setMuted(next)
    const { error } = await supabase.from('conversation_members').update({ muted: next }).eq('conversation_id', id).eq('user_id', me)
    if (error) {
      setMuted(!next)
      showNotice('Could not update your mute setting.')
    }
  }, [muted, id, me, showNotice])

  // ---------- message actions ----------
  const findMsg = (mid: string) => msgsRef.current.find((m) => m.id === mid)

  const onSelect = useCallback((mid: string) => setSelectedId((cur) => (cur === mid ? null : mid)), [])

  const onReact = useCallback(
    async (mid: string, emoji: string) => {
      const has = (reactionsRef.current[mid] ?? EMPTY).some((r) => r.user_id === me && r.emoji === emoji)
      const r: Reaction = { message_id: mid, user_id: me, emoji }
      setReactions((prev) => (has ? removeReaction(prev, r) : addReaction(prev, r)))
      setSelectedId(null)
      const res = has
        ? await supabase.from('message_reactions').delete().eq('message_id', mid).eq('user_id', me).eq('emoji', emoji)
        : await supabase.from('message_reactions').insert(r)
      if (res.error) {
        setReactions((prev) => (has ? addReaction(prev, r) : removeReaction(prev, r)))
        showNotice('Could not update your reaction.')
      }
    },
    [me, showNotice],
  )

  const onReply = useCallback((mid: string) => {
    const m = findMsg(mid)
    if (m) {
      setReplyTo(m)
      setEditing(null)
    }
    setSelectedId(null)
  }, [])

  const onCopy = useCallback(
    async (mid: string) => {
      const m = findMsg(mid)
      setSelectedId(null)
      if (!m?.body) return
      showNotice((await copyText(m.body)) ? 'Copied.' : 'Could not copy.')
    },
    [showNotice],
  )

  const onEdit = useCallback((mid: string) => {
    const m = findMsg(mid)
    if (m) {
      setEditing(m)
      setReplyTo(null)
    }
    setSelectedId(null)
  }, [])

  const saveEdit = useCallback(
    async (text: string) => {
      const target = editing
      setEditing(null)
      if (!target || text === target.body) return
      const { data, error } = await supabase.from('messages').update({ body: text }).eq('id', target.id).eq('sender_id', me).select().single()
      if (error || !data) {
        showNotice('Could not save your edit. Try again.')
        return
      }
      setMsgs((prev) => upsertMsg(prev, data as Msg))
    },
    [editing, me, showNotice],
  )

  const onUnsend = useCallback(
    async (mid: string) => {
      setSelectedId(null)
      if (!window.confirm('Unsend this message for everyone?')) return
      const { data, error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', mid).eq('sender_id', me).select().single()
      if (error || !data) {
        showNotice('Could not unsend the message. Try again.')
        return
      }
      setMsgs((prev) => upsertMsg(prev, data as Msg))
    },
    [me, showNotice],
  )

  const onDeleteForMe = useCallback(
    async (mid: string) => {
      setSelectedId(null)
      const { error } = await supabase.from('message_deletions').insert({ message_id: mid, user_id: me })
      if (error) {
        showNotice('Could not delete the message. Try again.')
        return
      }
      setMsgs((prev) => prev.filter((m) => m.id !== mid))
    },
    [me, showNotice],
  )

  const onRetry = useCallback(
    (mid: string) => {
      const m = findMsg(mid)
      const item = m ? getOutbox(me, id).find((i) => i.client_id === m.client_id) : undefined
      if (item) void deliver(item)
      else if (m) showNotice('This message can no longer be retried. Delete it and send again.')
    },
    [me, id, deliver, showNotice],
  )

  const onDiscard = useCallback(
    (mid: string) => {
      const m = findMsg(mid)
      if (m) removeOutbox(me, m.client_id)
      setMsgs((prev) => prev.filter((x) => x.id !== mid))
    },
    [me],
  )

  const onJumpTo = useCallback(
    (mid: string) => {
      const el = document.getElementById(`m-${mid}`)
      if (!el) {
        showNotice('That message is further up. Scroll up to load older messages.')
        return
      }
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      setHighlightId(mid)
      window.setTimeout(() => setHighlightId((cur) => (cur === mid ? null : cur)), 1500)
    },
    [showNotice],
  )

  // ---------- scrolling ----------
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
    }
  }, [msgs])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (load === 'ready' && el) {
      el.scrollTop = el.scrollHeight
      atBottom.current = true
    }
  }, [load])

  const lastMsg = msgs[msgs.length - 1]
  const lastId = lastMsg?.id ?? ''
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !lastMsg || load !== 'ready') return
    if (lastId === prevLastId.current) return
    prevLastId.current = lastId
    if (atBottom.current || lastMsg.sender_id === me) {
      el.scrollTop = el.scrollHeight
      setNewBelow(false)
    } else {
      setNewBelow(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, load])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom.current) setNewBelow(false)
    if (el.scrollTop < 60 && hasMore && !loadingMore) void loadOlder()
  }

  function jumpToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setNewBelow(false)
  }

  // ---------- render helpers ----------
  const msgById = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs])
  const nameOf = (uid: string | null) => (uid === me ? 'You' : (uid && profiles[uid]?.display_name) || 'Deleted user')

  const items = useMemo(() => {
    let prevDay = ''
    return msgs.map((m) => {
      const day = new Date(m.created_at).toDateString()
      const header = day !== prevDay ? dayLabel(m.created_at) : null
      prevDay = day
      return { m, header }
    })
  }, [msgs])

  const lastMineSent = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].sender_id === me && msgs[i].status === 'sent') return msgs[i]
    return null
  }, [msgs, me])

  function statusFor(m: LocalMsg): string | null {
    if (isGroup || !lastMineSent || m.id !== lastMineSent.id || m.deleted_at) return null
    const t = ts(m.created_at)
    if (receipts.read >= t) return 'Read'
    if (receipts.delivered >= t) return 'Delivered'
    return 'Sent'
  }

  function replyInfo(m: LocalMsg) {
    if (!m.reply_to_id) return { name: '', text: '' }
    const src: ReplySrc | undefined = msgById.get(m.reply_to_id) ?? replyCache[m.reply_to_id]
    if (!src) return { name: 'Message', text: 'Original message unavailable' }
    return { name: nameOf(src.sender_id), text: previewOf(src.kind, src.body, Boolean(src.deleted_at)) }
  }

  // ---------- states ----------
  if (load === 'loading') {
    return <div className="flex flex-1 items-center justify-center text-brand-600"><Spinner className="h-7 w-7" /></div>
  }
  if (load === 'missing') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">Conversation not found</h2>
        <p className="text-slate-500 dark:text-slate-400">It may not exist, or you are not a member of it.</p>
        <Link to="/" className="btn-primary">Back to chats</Link>
      </div>
    )
  }
  if (load === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">Could not load this chat</h2>
        <p className="text-slate-500 dark:text-slate-400">Check your connection and try again.</p>
        <button type="button" className="btn-primary" onClick={() => { setLoad('loading'); void loadAll() }}>Retry</button>
      </div>
    )
  }

  const isGroup = conv?.type === 'group'
  const other = otherId ? profiles[otherId] : undefined
  const isOnline = otherId ? rt.online.has(otherId) : false
  const title = isGroup ? conv?.name ?? 'Group' : other?.display_name ?? 'Conversation'
  const subtitle = isGroup
    ? `${memberCount} member${memberCount === 1 ? '' : 's'}`
    : isOnline
      ? 'Online'
      : other
        ? `Last seen ${lastSeenText(other.last_seen)}`
        : ''
  const headerLink = isGroup ? `/chat/${id}/info` : other ? `/u/${other.username}` : '/'
  const typingNames = typingIds.map((uid) => profiles[uid]?.display_name ?? 'Someone')
  const typingText = typingNames.length === 0 ? '' : typingNames.length === 1 ? `${typingNames[0]} is typing...` : `${typingNames.slice(0, -1).join(', ')} and ${typingNames[typingNames.length - 1]} are typing...`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className="flex items-center gap-2 border-b border-slate-200/80 bg-white/80 px-2 pb-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0d12]/80"
        style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}
      >
        <Link to="/" aria-label="Back to chats" className="flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-brand-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:hidden dark:text-brand-300 dark:hover:bg-white/5">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Chats
        </Link>
        <Link
          to={headerLink}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Avatar path={isGroup ? conv?.avatar_path : other?.avatar_path} name={title} size={40} online={isGroup ? undefined : isOnline} />
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{title}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => {
            if (otherId) void calls.startCall(id, otherId, title, false)
          }}
          disabled={isGroup || !otherId}
          aria-label="Start audio call"
          title={isGroup ? 'Calls are available in direct conversations' : 'Start audio call'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 11.2 19a19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1z" /></svg>
        </button>
        <button
          type="button"
          onClick={() => {
            if (otherId) void calls.startCall(id, otherId, title, true)
          }}
          disabled={isGroup || !otherId}
          aria-label="Start video call"
          title={isGroup ? 'Calls are available in direct conversations' : 'Start video call'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></svg>
        </button>
        <button
          type="button"
          onClick={() => void toggleMute()}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute conversation' : 'Mute conversation'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-300 dark:hover:bg-white/5"
        >
          {muted ? (
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.7 3.4A6 6 0 0 1 18 8v5a2 2 0 0 0 .6 1.4M6 8a6 6 0 0 0-1 3.4V13a2 2 0 0 1-1 1.7" />
              <path d="M9 18a2.5 2.5 0 0 0 5 0" />
              <path d="M4 4 20 20" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8a6 6 0 0 0-12 0v5a2 2 0 0 1-1 1.7V16h14v-1.3A2 2 0 0 1 18 13z" />
              <path d="M9 18a2.5 2.5 0 0 0 5 0" />
            </svg>
          )}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full space-y-1.5 overflow-y-auto overscroll-contain px-3 py-4">
          {loadingMore && <div className="flex justify-center py-2 text-brand-600"><Spinner className="h-5 w-5" /></div>}
          {!hasMore && msgs.length === 0 && (
            <p className="py-16 text-center text-[15px] text-slate-500 dark:text-slate-400">No messages yet. Say hello to {title}.</p>
          )}
          {items.map(({ m, header }) => {
            const reply = replyInfo(m)
            return (
              <div key={m.id}>
                {header && <p className="py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400">{header}</p>}
                <MessageBubble
                  msg={m}
                  mine={m.sender_id === me}
                  meId={me}
                  senderLabel={isGroup && m.sender_id !== me ? nameOf(m.sender_id) : undefined}
                  reactions={reactions[m.id] ?? EMPTY}
                  selected={selectedId === m.id}
                  highlighted={highlightId === m.id}
                  statusText={statusFor(m)}
                  replyId={m.reply_to_id}
                  replyName={reply.name}
                  replyText={reply.text}
                  onSelect={onSelect}
                  onReact={onReact}
                  onReply={onReply}
                  onCopy={onCopy}
                  onEdit={onEdit}
                  onUnsend={onUnsend}
                  onDeleteForMe={onDeleteForMe}
                  onRetry={onRetry}
                  onDiscard={onDiscard}
                  onJumpTo={onJumpTo}
                />
              </div>
            )
          })}
        </div>
        {newBelow && (
          <button type="button" onClick={jumpToBottom} className="btn-primary animate-pop-in absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg">
            New messages
          </button>
        )}
      </div>

      <div className="min-h-[1.25rem] px-4 pb-1 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">{typingText}</div>
      {notice && (
        <div role="status" className="animate-slide-up mx-3 mb-2 flex items-center justify-between gap-3 rounded-xl bg-slate-800 px-4 py-2.5 text-sm text-white dark:bg-slate-200 dark:text-slate-900">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Dismiss</button>
        </div>
      )}

      <Composer
        editing={editing}
        reply={replyTo ? { name: nameOf(replyTo.sender_id), text: previewOf(replyTo.kind, replyTo.body, Boolean(replyTo.deleted_at)) } : null}
        onSend={send}
        onSaveEdit={(t) => void saveEdit(t)}
        onCancel={() => { setEditing(null); setReplyTo(null) }}
        onTyping={sendTyping}
      />
    </div>
  )
}
