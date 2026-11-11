import { Link, useMatch } from 'react-router-dom'
import { useRealtime } from '../context/RealtimeContext'
import { useOnline, useViewportHeight } from '../lib/hooks'
import { BottomTabs, DesktopNav } from './AppShell'
import ChatList from './ChatList'
import Conversation from './Conversation'
import NotifyBanner from './NotifyBanner'
import { Logo } from './ui'

export default function ChatLayout() {
  const match = useMatch('/chat/:id')
  const id = match?.params.id
  const vh = useViewportHeight()
  const online = useOnline()
  const rt = useRealtime()

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: vh ? `${vh}px` : '100dvh' }}>
      {(!online || rt.status === 'reconnecting') && (
        <div role="status" className="bg-amber-500 px-4 py-1.5 text-center text-sm font-medium text-slate-950" style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}>
          {!online ? "You're offline. Unsent messages will send when you're back online." : 'Reconnecting...'}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className={`${id ? 'hidden md:flex' : 'flex'} min-h-0 w-full flex-col border-r border-slate-200/80 md:w-[360px] md:shrink-0 dark:border-white/10`}>
          <header className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 pb-3 dark:border-white/10" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
            <div className="flex items-center gap-2.5">
              <Logo size={32} />
              <h1 className="text-lg font-semibold tracking-tight">Chats</h1>
            </div>
            <Link to="/people" className="btn-ghost px-3 py-1.5 text-sm">New message</Link>
          </header>
          <NotifyBanner />
          <div className="hidden border-b border-slate-200/80 px-2 py-1.5 md:block dark:border-white/10"><DesktopNav /></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><ChatList activeId={id} /></div>
          <BottomTabs />
        </aside>
        <section className={`${id ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          {id ? (
            <Conversation key={id} id={id} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Logo size={56} />
              <h2 className="text-xl font-semibold">Your messages</h2>
              <p className="max-w-xs text-slate-500 dark:text-slate-400">Pick a conversation on the left, or find someone new to talk to.</p>
              <Link to="/people" className="btn-primary">Find people</Link>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
