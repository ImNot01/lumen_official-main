import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../context/RealtimeContext'
import { useChatList } from '../context/ChatListContext'
import { listTime, previewOf } from '../lib/chat'
import { Avatar } from './Avatar'
import { Alert, Spinner } from './ui'

const BellOffIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.7 3.4A6 6 0 0 1 18 8v5a2 2 0 0 0 .6 1.4M6 8a6 6 0 0 0-1 3.4V13a2 2 0 0 1-1 1.7" />
    <path d="M9 18a2.5 2.5 0 0 0 5 0" />
    <path d="M4 4 20 20" />
  </svg>
)

export default function ChatList({ activeId }: { activeId?: string }) {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const rt = useRealtime()
  const { rows, state, refresh } = useChatList()

  if (state === 'loading') {
    return <div className="flex justify-center py-12 text-brand-600"><Spinner className="h-6 w-6" /></div>
  }
  if (state === 'error') {
    return (
      <div className="space-y-3 p-4">
        <Alert kind="error">Could not load your chats. Check your connection and try again.</Alert>
        <button type="button" className="btn-ghost" onClick={refresh}>Retry</button>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <h2 className="text-lg font-semibold">No conversations yet</h2>
        <p className="mt-1.5 text-[15px] text-slate-500 dark:text-slate-400">Find someone and send your first message.</p>
        <Link to="/people" className="btn-primary mt-5">Find people</Link>
      </div>
    )
  }

  return (
    <ul>
      {rows.map((r) => {
        const name = r.ctype === 'direct' ? r.other_display_name ?? 'Deleted user' : r.cname ?? 'Group'
        const avatar = r.ctype === 'direct' ? r.other_avatar : r.cavatar
        const isOnline = r.ctype === 'direct' && r.other_id ? rt.online.has(r.other_id) : undefined
        const preview = previewOf(r.last_kind, r.last_body, r.last_deleted)
        const prefix = r.last_sender === me && !r.last_deleted ? 'You: ' : ''
        const unread = r.unread > 0 && !r.muted
        return (
          <li key={r.cid}>
            <Link
              to={`/chat/${r.cid}`}
              aria-current={activeId === r.cid ? 'page' : undefined}
              className={`flex items-center gap-3 px-4 py-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
                activeId === r.cid ? 'bg-brand-700/10 dark:bg-brand-400/10' : 'hover:bg-slate-100/80 dark:hover:bg-white/5'
              }`}
            >
              <Avatar path={avatar} name={name} size={52} online={isOnline} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <p className={`truncate ${unread ? 'font-semibold' : 'font-medium'}`}>{name}</p>
                    {r.muted && <span className="shrink-0 text-slate-400 dark:text-slate-500" aria-label="Muted"><BellOffIcon /></span>}
                  </span>
                  <span className={`shrink-0 text-xs ${unread ? 'font-semibold text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}>{listTime(r.last_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${unread ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{prefix}{preview}</p>
                  {unread && (
                    <span className="animate-pop-in flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs font-semibold text-white dark:bg-brand-500 dark:text-slate-950" aria-label={`${r.unread} unread`}>
                      {r.unread > 99 ? '99+' : r.unread}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
