import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './Avatar'
import { Logo } from './ui'

const icon = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

const ChatIcon = () => (
  <svg {...icon}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12z" /></svg>
)
const SearchIcon = () => (
  <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
const UserIcon = () => (
  <svg {...icon}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
)

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive
      ? 'bg-brand-700/10 text-brand-800 dark:bg-brand-400/15 dark:text-brand-300'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5'
  }`

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'
  }`

export function DesktopNav() {
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      <NavLink to="/" end className={linkClass}><ChatIcon /> Chats</NavLink>
      <NavLink to="/people" className={linkClass}><SearchIcon /> People</NavLink>
      <NavLink to="/profile" className={linkClass}><UserIcon /> Profile</NavLink>
    </nav>
  )
}

export function BottomTabs({ fixed = false }: { fixed?: boolean }) {
  return (
    <nav
      className={`${fixed ? 'fixed inset-x-0 bottom-0 z-20' : ''} border-t border-slate-200/80 bg-white/85 backdrop-blur-xl md:hidden dark:border-white/10 dark:bg-[#0b0d12]/85`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-md">
        <NavLink to="/" end className={tabClass}><ChatIcon /> Chats</NavLink>
        <NavLink to="/people" className={tabClass}><SearchIcon /> People</NavLink>
        <NavLink to="/profile" className={tabClass}><UserIcon /> Profile</NavLink>
      </div>
    </nav>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  return (
    <div className="min-h-[100dvh]">
      <header
        className="sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/80 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0d12]/80"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Lumen home">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight">Lumen</span>
          </Link>
          <DesktopNav />
          {profile && (
            <Link to="/profile" aria-label="Your profile" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:hidden">
              <Avatar path={profile.avatar_path} name={profile.display_name} size={32} />
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6 md:pb-10">{children}</main>
      <BottomTabs fixed />
    </div>
  )
}
