import { useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { getTheme, setTheme } from '../lib/theme'
import type { Theme } from '../lib/theme'

export function Logo({ size = 48 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl bg-brand-700 shadow-lg shadow-brand-900/20 dark:bg-brand-500"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width={size * 0.58} height={size * 0.58}>
        <path
          d="M18 22a8 8 0 0 1 8-8h12a8 8 0 0 1 8 8v10a8 8 0 0 1-8 8H31l-9 8v-8.4A8 8 0 0 1 18 32z"
          className="fill-white dark:fill-slate-950"
        />
      </svg>
    </div>
  )
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Splash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center">
      <Spinner className="h-7 w-7 text-brand-600" />
    </div>
  )
}

export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(getTheme())
  const order: Theme[] = ['system', 'light', 'dark']
  const label = theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'
  return (
    <button
      type="button"
      className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
      aria-label={`Theme: ${label}. Tap to change.`}
      onClick={() => {
        const next = order[(order.indexOf(theme) + 1) % order.length]
        setTheme(next)
        setLocal(next)
      }}
    >
      Theme: {label}
    </button>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const styles =
    kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
      : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  )
}

type FieldProps = { label: string; id: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>

export function Field({ label, id, hint, type, ...rest }: FieldProps) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        <input id={id} type={isPassword && show ? 'text' : type} className={`input ${isPassword ? 'pr-16' : ''}`} {...rest} />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:text-slate-100"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && <div className="mt-1.5 text-sm">{hint}</div>}
    </div>
  )
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl"
      />
      <div className="absolute right-4 top-4" style={{ marginTop: 'env(safe-area-inset-top)' }}>
        <ThemeToggle />
      </div>
      <main className="relative w-full max-w-md">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-xs text-[15px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <div className="glass p-6 sm:p-8">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">{footer}</div>}
      </main>
    </div>
  )
}
