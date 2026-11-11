import { useEffect, useState } from 'react'
import { avatarUrl } from '../lib/supabase'

type Props = {
  path?: string | null
  src?: string | null
  name: string
  size?: number
  className?: string
  /** pass true/false to show a presence dot; leave undefined for none */
  online?: boolean
}

export function Avatar({ path, src, name, size = 40, className = '', online }: Props) {
  const [failed, setFailed] = useState(false)
  const url = src ?? (path ? avatarUrl(path) : null)

  useEffect(() => {
    setFailed(false)
  }, [url])

  const box = { width: size, height: size }
  let inner
  if (url && !failed) {
    inner = (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={box}
      />
    )
  } else {
    const initial = (name.trim().charAt(0) || '?').toUpperCase()
    inner = (
      <div
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-semibold text-white dark:bg-brand-500 dark:text-slate-950 ${className}`}
        style={{ ...box, fontSize: size * 0.42 }}
      >
        {initial}
      </div>
    )
  }

  if (online === undefined) return inner
  return (
    <span className="relative inline-flex shrink-0">
      {inner}
      {online && (
        <span className="absolute bottom-0 right-0 flex h-3 w-3" role="img" aria-label="Online">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400" style={{ animation: 'lumen-pulse-ring 1.8s cubic-bezier(0,0,0.2,1) infinite' }} />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#0b0d12]" />
        </span>
      )}
    </span>
  )
}
