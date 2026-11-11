import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Avatar } from '../components/Avatar'
import { Alert, Spinner } from '../components/ui'

type Row = { id: string; username: string; display_name: string; avatar_path: string | null }
type SearchState = 'idle' | 'loading' | 'done' | 'error'

export default function People() {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Row[]>([])
  const [state, setState] = useState<SearchState>('idle')
  const seq = useRef(0)

  const run = useCallback(
    async (term: string) => {
      const id = ++seq.current
      setState('loading')
      const { data, error } = await supabase
        .from('profiles')
        .select('id,username,display_name,avatar_path')
        .or(`username.ilike.${term}*,display_name.ilike.*${term}*`)
        .neq('id', me)
        .order('username')
        .limit(20)
      if (id !== seq.current) return
      if (error) {
        setState('error')
        return
      }
      setResults((data as Row[]) ?? [])
      setState('done')
    },
    [me],
  )

  const term = q.trim().toLowerCase().replace(/[%*,()"'\\:]/g, '')

  useEffect(() => {
    if (term.length < 2) {
      seq.current++
      setState('idle')
      setResults([])
      return
    }
    const t = setTimeout(() => void run(term), 300)
    return () => clearTimeout(t)
  }, [term, run])

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Find people</h1>
      <p className="mt-1 text-[15px] text-slate-500 dark:text-slate-400">Search by name or username.</p>

      <div className="mt-5">
        <label htmlFor="search" className="sr-only">Search people</label>
        <input
          id="search"
          type="search"
          className="input"
          placeholder="Search people"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="mt-5" aria-live="polite">
        {state === 'idle' && (
          <p className="py-10 text-center text-[15px] text-slate-500 dark:text-slate-400">
            Type at least 2 characters to search.
          </p>
        )}
        {state === 'loading' && (
          <div className="flex justify-center py-10 text-brand-600"><Spinner className="h-6 w-6" /></div>
        )}
        {state === 'error' && (
          <div className="space-y-3">
            <Alert kind="error">Search failed. Check your connection and try again.</Alert>
            <button type="button" className="btn-ghost" onClick={() => void run(term)}>Retry</button>
          </div>
        )}
        {state === 'done' && results.length === 0 && (
          <p className="py-10 text-center text-[15px] text-slate-500 dark:text-slate-400">
            No one found for "{q.trim()}".
          </p>
        )}
        {state === 'done' && results.length > 0 && (
          <ul className="glass divide-y divide-slate-200/70 overflow-hidden p-0 dark:divide-white/10">
            {results.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/u/${r.username}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-white/5"
                >
                  <Avatar path={r.avatar_path} name={r.display_name} size={44} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.display_name}</p>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">@{r.username}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
