import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../context/RealtimeContext'
import { useChatList } from '../context/ChatListContext'
import { useActiveChat } from '../context/ActiveChatContext'
import { previewOf } from '../lib/chat'
import type { Msg } from '../lib/chat'
import { getPermission, registerPushSubscription, showNotification } from '../lib/notify'

/** Mounted once near the app root. Renders nothing; only listens and notifies. */
export default function NotificationManager() {
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const rt = useRealtime()
  const { rows, unreadTotal } = useChatList()
  const { activeId } = useActiveChat()
  const navigate = useNavigate()
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const previousForegroundAt = useRef<number | null>(null)
  const recoveredNotificationIds = useRef(new Set<string>())

  useEffect(() => {
    const key = 'lumen:last-foreground-at'
    try {
      const previous = Number(localStorage.getItem(key))
      previousForegroundAt.current = Number.isFinite(previous) && previous > 0 ? previous : Date.now()
    } catch {
      previousForegroundAt.current = Date.now()
    }
    const updateForegroundTime = () => {
      if (document.visibilityState !== 'visible') return
      try {
        localStorage.setItem(key, String(Date.now()))
      } catch (error) {
        console.error('Could not persist notification recovery time', error)
      }
    }
    updateForegroundTime()
    const timer = window.setInterval(updateForegroundTime, 30000)
    document.addEventListener('visibilitychange', updateForegroundTime)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', updateForegroundTime)
    }
  }, [])

  // Restore the push subscription when a user returns with permission already granted.
  useEffect(() => {
    if (!me || getPermission() !== 'granted') return
    void registerPushSubscription(me).catch((error: unknown) => {
      console.error('Push notification setup failed', error)
    })
  }, [me])

  // A tap on a notification tells an already-open tab where to go.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined
      if (data?.type === 'lumen-navigate' && typeof data.url === 'string') navigate(data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  useEffect(() => {
    if (!me) return
    return rt.on('message', (p: any) => {
      if (p?.op !== 'INSERT') return
      const rec = p.record as Msg | undefined
      if (!rec?.sender_id || rec.sender_id === me) return
      const row = rowsRef.current.find((item) => item.cid === rec.conversation_id)
      if (row?.muted) return
      if (activeRef.current === rec.conversation_id && document.visibilityState === 'visible') return
      const title = (row?.ctype === 'group' ? row.cname : row?.other_display_name) ?? 'New message'
      const body = previewOf(rec.kind, rec.body, false)
      void showNotification(title, body, `/chat/${rec.conversation_id}`, `lumen-message-${rec.id}`)
    })
  }, [rt, me])

  useEffect(() => {
    const since = previousForegroundAt.current
    if (!me || since === null) return
    for (const row of rows) {
      if (row.unread < 1 || row.last_sender === me || row.last_deleted || row.muted) continue
      if (Date.parse(row.last_at) <= since) continue
      if (activeId === row.cid && document.visibilityState === 'visible') continue
      if (recoveredNotificationIds.current.has(row.last_id)) continue
      recoveredNotificationIds.current.add(row.last_id)
      void showNotification(
        (row.ctype === 'group' ? row.cname : row.other_display_name) ?? 'New message',
        previewOf(row.last_kind, row.last_body, false),
        `/chat/${row.cid}`,
        `lumen-message-${row.last_id}`,
      )
    }
  }, [activeId, me, rows])

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal > 99 ? '99+' : unreadTotal}) Lumen` : 'Lumen'
    return () => {
      document.title = 'Lumen'
    }
  }, [unreadTotal])

  return null
}
