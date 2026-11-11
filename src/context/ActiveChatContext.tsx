import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type ActiveChatState = { activeId: string | null; setActiveId: (id: string | null) => void }
const Ctx = createContext<ActiveChatState | null>(null)

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const value = useMemo(() => ({ activeId, setActiveId }), [activeId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActiveChat(): ActiveChatState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useActiveChat must be used inside ActiveChatProvider')
  return v
}
